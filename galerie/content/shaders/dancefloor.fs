/*{
  "DESCRIPTION": "Disco dancefloor en perspective — grille de dalles paramétrables. v1.0",
  "CREDIT": "yr0-lab",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "grid_cols",       "TYPE": "float", "DEFAULT": 8.0,   "MIN": 2.0,  "MAX": 32.0 },
    { "NAME": "grid_rows",       "TYPE": "float", "DEFAULT": 6.0,   "MIN": 2.0,  "MAX": 32.0 },
    { "NAME": "horizon_y",       "TYPE": "float", "DEFAULT": 0.4,   "MIN": 0.0,  "MAX": 0.8  },
    { "NAME": "tile_gap",        "TYPE": "float", "DEFAULT": 0.05,  "MIN": 0.0,  "MAX": 0.3  },
    { "NAME": "camera_tilt",     "TYPE": "float", "DEFAULT": 1.0,   "MIN": 0.3,  "MAX": 3.0  },
    { "NAME": "pattern_mode",    "TYPE": "float", "DEFAULT": 0.0,   "MIN": 0.0,  "MAX": 6.0  },
    { "NAME": "pattern_speed",   "TYPE": "float", "DEFAULT": 1.0,   "MIN": 0.0,  "MAX": 5.0  },
    { "NAME": "pattern_density", "TYPE": "float", "DEFAULT": 0.5,   "MIN": 0.0,  "MAX": 1.0  },
    { "NAME": "pattern_mix",     "TYPE": "float", "DEFAULT": 1.0,   "MIN": 0.0,  "MAX": 1.0  },
    { "NAME": "tile_color",      "TYPE": "color", "DEFAULT": [1.0, 0.12, 0.82, 1.0]          },
    { "NAME": "tile_off_color",  "TYPE": "color", "DEFAULT": [0.02, 0.02, 0.07, 1.0]         },
    { "NAME": "sky_color",       "TYPE": "color", "DEFAULT": [0.0,  0.0,  0.02, 1.0]         },
    { "NAME": "hue_spread",      "TYPE": "float", "DEFAULT": 0.3,   "MIN": 0.0,  "MAX": 1.0  },
    { "NAME": "glow_strength",   "TYPE": "float", "DEFAULT": 0.4,   "MIN": 0.0,  "MAX": 1.0  },
    { "NAME": "brightness",      "TYPE": "float", "DEFAULT": 0.85,  "MIN": 0.0,  "MAX": 1.5  },
    { "NAME": "tiles_mask_lo",   "TYPE": "float", "DEFAULT": 0.0,   "MIN": 0.0,  "MAX": 1.0  },
    { "NAME": "tiles_mask_hi",   "TYPE": "float", "DEFAULT": 0.0,   "MIN": 0.0,  "MAX": 1.0  },
    { "NAME": "audio_react",     "TYPE": "bool",  "DEFAULT": false                            },
    { "NAME": "tempo_bpm",       "TYPE": "float", "DEFAULT": 120.0, "MIN": 60.0, "MAX": 240.0},
    { "NAME": "animate",         "TYPE": "bool",  "DEFAULT": true                             }
  ]
}*/

// HSV <-> RGB (no float equality comparisons)
vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-4)), d / (q.x + 1e-4), q.x);
}

// Pseudo-random hash (WebGL 1 compatible)
float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 17.5);
    return fract(p.x * p.y);
}

// Extract bit from float-encoded mask (24-bit precision, bitIdx in [0,23])
// Encode: mask = bitInteger / 16777215.0
float getBit(float mask, float bitIdx) {
    float bits = floor(mask * 16777215.0 + 0.5);
    return floor(mod(bits / pow(2.0, bitIdx), 2.0));
}

void main() {
    vec2 fc = isf_FragNormCoord.xy;  // (0,0)=bottom-left, (1,1)=top-right
    float sx = fc.x;
    float sy = fc.y;
    float t  = animate ? TIME : 0.0;
    float gc = float(grid_cols);
    float gr = float(grid_rows);
    int   pm = int(pattern_mode + 0.5);

    // ---- SKY (above horizon) ----
    if (sy >= horizon_y) {
        gl_FragColor = vec4(sky_color.rgb * brightness, sky_color.a);
        return;
    }

    // ---- PERSPECTIVE PROJECTION ----
    // depth: camera_tilt/horizon_y at screen bottom, → ∞ at horizon
    float fy    = max(horizon_y - sy, 0.001);
    float depth = camera_tilt / fy;
    float Znear = camera_tilt / horizon_y;     // depth at sy=0
    float tileW = Znear / gc;                  // square tile size in floor space

    float tileU = (sx - 0.5) * depth / tileW + gc * 0.5;
    float tileV = (depth - Znear) / tileW;     // 0 at bottom, increases toward horizon

    float fu   = fract(tileU);
    float fv   = fract(tileV);
    float fcol = mod(floor(tileU), gc);
    float frow = mod(floor(tileV), gr);
    float idx  = frow * gc + fcol;             // linear tile index in [0, gc*gr-1]

    // ---- GAP (smooth edges) ----
    float hg     = tile_gap * 0.5;
    float inTile = smoothstep(hg, hg + 0.02, min(fu, 1.0 - fu)) *
                   smoothstep(hg, hg + 0.02, min(fv, 1.0 - fv));

    // ---- GLOW (exp falloff from tile center, bleeds into gap) ----
    float tileDist = length(vec2(fu - 0.5, fv - 0.5)) * 2.0;  // 0=center, 1=tile edge
    float glowFade = exp(-max(tileDist - 0.85, 0.0) * 18.0);

    // ---- MASK DECODE (tiles 0..23 in lo, 24..47 in hi) ----
    float maskBit = 0.0;
    if (idx < 24.0)      maskBit = getBit(tiles_mask_lo, idx);
    else if (idx < 48.0) maskBit = getBit(tiles_mask_hi, idx - 24.0);

    // ---- PATTERN (modes 1-6 produce animated lit values) ----
    float rowFl = floor(tileV);   // unbounded row for sweep continuity
    float colFl = floor(tileU);
    float patternLit = 0.0;

    if (pm == 1) {
        // Checkerboard pulsant
        float checker = mod(fcol + frow, 2.0) < 1.0 ? 1.0 : 0.0;
        float pulse   = step(1.0 - pattern_density, 0.5 + 0.5 * sin(t * pattern_speed * 3.14159));
        patternLit    = checker * pulse;
    } else if (pm == 2) {
        // Ripple depuis le centre
        float dist = length(vec2(fcol - gc * 0.5, frow - gr * 0.5));
        float wave = 0.5 + 0.5 * sin(dist * 2.0 - t * pattern_speed * 5.0);
        patternLit = step(1.0 - pattern_density, wave);
    } else if (pm == 3) {
        // Random scintillement
        float timeBin = floor(t * pattern_speed * 3.0);
        patternLit    = step(1.0 - pattern_density, hash21(vec2(fcol, frow) + timeBin));
    } else if (pm == 4) {
        // Row sweep (vague horizontale, de proche à lointain)
        float sweep = mod(rowFl - t * pattern_speed * gr * 0.3, gr);
        patternLit  = step(sweep, gr * pattern_density);
    } else if (pm == 5) {
        // Col sweep (vague verticale)
        float sweep = mod(colFl - t * pattern_speed * gc * 0.3, gc);
        patternLit  = step(sweep, gc * pattern_density);
    } else if (pm == 6) {
        // Diagonal sweep
        float sweep = mod(colFl + rowFl - t * pattern_speed * (gc + gr) * 0.2, gc + gr);
        patternLit  = step(sweep, (gc + gr) * pattern_density);
    }

    // ---- LIT VALUE (blend mask + pattern, audio modulation) ----
    float audioMod = audio_react
        ? (0.75 + 0.25 * sin(t * tempo_bpm / 60.0 * 3.14159))
        : 1.0;
    float litValue = clamp(mix(maskBit, patternLit, pattern_mix) * audioMod, 0.0, 1.0);

    // ---- TILE COLOR WITH HUE SPREAD ----
    vec3 hsv = rgb2hsv(tile_color.rgb);
    hsv.x    = fract(hsv.x + fract(idx / (gc * gr)) * hue_spread);
    vec3 tileOnColor = hsv2rgb(hsv);

    // ---- COMPOSITING ----
    vec3 offColor = tile_off_color.rgb;
    vec3 col = mix(offColor, mix(offColor, tileOnColor, litValue), inTile);
    col += tileOnColor * glowFade * glow_strength * litValue;
    col *= brightness;

    gl_FragColor = vec4(col, 1.0);
}
