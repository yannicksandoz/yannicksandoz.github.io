/*{
  "DESCRIPTION": "Procedural dog (Cocker Spaniel) — head and body with animation controls. v2.0",
  "CREDIT": "yr0-lab",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "fur_color",     "TYPE": "color", "DEFAULT": [0.82, 0.62, 0.30, 1.0] },
    { "NAME": "eye_color",     "TYPE": "color", "DEFAULT": [0.35, 0.22, 0.08, 1.0] },
    { "NAME": "bg_color",      "TYPE": "color", "DEFAULT": [0.05, 0.05, 0.12, 1.0] },
    { "NAME": "outline_color", "TYPE": "color", "DEFAULT": [0.28, 0.16, 0.06, 1.0] },
    { "NAME": "outline_width", "TYPE": "float", "DEFAULT": 0.013, "MIN": 0.0,   "MAX": 0.04  },
    { "NAME": "pupil_dilation","TYPE": "float", "DEFAULT": 0.5,   "MIN": 0.0,   "MAX": 1.0  },
    { "NAME": "mouth_open",    "TYPE": "float", "DEFAULT": 0.0,   "MIN": 0.0,   "MAX": 1.0  },
    { "NAME": "animate",       "TYPE": "bool",  "DEFAULT": true   },
    { "NAME": "blink_rate",    "TYPE": "float", "DEFAULT": 1.0,   "MIN": 0.2,   "MAX": 4.0  },
    { "NAME": "blink_t",       "TYPE": "float", "DEFAULT": 1.0,   "MIN": 0.0,   "MAX": 1.0  },
    { "NAME": "bob_amp",       "TYPE": "float", "DEFAULT": 0.5,   "MIN": 0.0,   "MAX": 1.0  },
    { "NAME": "bob_t",         "TYPE": "float", "DEFAULT": 0.5,   "MIN": 0.0,   "MAX": 1.0  },
    { "NAME": "ear_amp",       "TYPE": "float", "DEFAULT": 0.5,   "MIN": 0.0,   "MAX": 1.0  },
    { "NAME": "ear_t",         "TYPE": "float", "DEFAULT": 0.5,   "MIN": 0.0,   "MAX": 1.0  },
    { "NAME": "tail_amp",      "TYPE": "float", "DEFAULT": 0.5,   "MIN": 0.0,   "MAX": 3.0  },
    { "NAME": "tail_t",        "TYPE": "float", "DEFAULT": 0.0,   "MIN": 0.0,   "MAX": 1.0  },
    { "NAME": "tail_length",   "TYPE": "float", "DEFAULT": 1.0,   "MIN": 0.2,   "MAX": 2.5  },
    { "NAME": "show_body",     "TYPE": "bool",  "DEFAULT": false  },
    { "NAME": "neck_gap",      "TYPE": "float", "DEFAULT": -0.05, "MIN": -0.20, "MAX": 0.28 },
    { "NAME": "body_scale",    "TYPE": "float", "DEFAULT": 0.65,  "MIN": 0.45,  "MAX": 0.90 },
    { "NAME": "paw_f_radius",  "TYPE": "float", "DEFAULT": 0.0,   "MIN": 0.0,   "MAX": 0.35 },
    { "NAME": "paw_f_t",       "TYPE": "float", "DEFAULT": 0.0,   "MIN": 0.0,   "MAX": 1.0  },
    { "NAME": "paw_f_spread",  "TYPE": "float", "DEFAULT": 0.0,   "MIN": -0.15, "MAX": 0.30 },
    { "NAME": "paw_f_l_x",    "TYPE": "float", "DEFAULT": 0.0,   "MIN": -0.40, "MAX": 0.40 },
    { "NAME": "paw_f_l_y",    "TYPE": "float", "DEFAULT": 0.0,   "MIN": -0.40, "MAX": 0.40 },
    { "NAME": "paw_f_r_x",    "TYPE": "float", "DEFAULT": 0.0,   "MIN": -0.40, "MAX": 0.40 },
    { "NAME": "paw_f_r_y",    "TYPE": "float", "DEFAULT": 0.0,   "MIN": -0.40, "MAX": 0.40 },
    { "NAME": "paw_f_size",    "TYPE": "float", "DEFAULT": 0.098, "MIN": 0.04,  "MAX": 0.18 },
    { "NAME": "paw_b_radius",  "TYPE": "float", "DEFAULT": 0.0,   "MIN": 0.0,   "MAX": 0.35 },
    { "NAME": "paw_b_t",       "TYPE": "float", "DEFAULT": 0.0,   "MIN": 0.0,   "MAX": 1.0  },
    { "NAME": "paw_b_spread",  "TYPE": "float", "DEFAULT": 0.0,   "MIN": -0.15, "MAX": 0.30 },
    { "NAME": "paw_b_x",       "TYPE": "float", "DEFAULT": 0.0,   "MIN": -0.40, "MAX": 0.40 },
    { "NAME": "paw_b_y",       "TYPE": "float", "DEFAULT": 0.0,   "MIN": -0.40, "MAX": 0.40 },
    { "NAME": "paw_b_size",    "TYPE": "float", "DEFAULT": 0.092, "MIN": 0.04,  "MAX": 0.18 },
    { "NAME": "show_bone",     "TYPE": "bool",  "DEFAULT": false  },
    { "NAME": "bone_color",    "TYPE": "color", "DEFAULT": [0.96, 0.93, 0.85, 1.0] },
    { "NAME": "bone_x",        "TYPE": "float", "DEFAULT": 0.0,   "MIN": -1.0,  "MAX": 1.0  },
    { "NAME": "bone_y",        "TYPE": "float", "DEFAULT": 0.0,   "MIN": -0.60, "MAX": 1.60 },
    { "NAME": "bone_pan",      "TYPE": "float", "DEFAULT": 0.0,   "MIN": -1.0,  "MAX": 1.0  },
    { "NAME": "bone_size",     "TYPE": "float", "DEFAULT": 0.06,  "MIN": 0.02,  "MAX": 0.18 },
    { "NAME": "bone_angle",    "TYPE": "float", "DEFAULT": 0.0,   "MIN": -1.0,  "MAX": 1.0  },
    { "NAME": "ear_color",     "TYPE": "color", "DEFAULT": [0.66, 0.44, 0.18, 1.0] },
    { "NAME": "mirror",        "TYPE": "bool",  "DEFAULT": false  }
  ]
}*/

float sdCircle(vec2 p, float r) { return length(p) - r; }

float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d,0.0)) + min(max(d.x,d.y),0.0);
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa=p-a, ba=b-a;
    return length(pa - ba*clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0));
}

float sdBezier(vec2 pos, vec2 A, vec2 B, vec2 C) {
    vec2 a=B-A, b=A-2.0*B+C, c=a*2.0, d=A-pos;
    float kk=1.0/dot(b,b), kx=kk*dot(a,b);
    float ky=kk*(2.0*dot(a,a)+dot(d,b))/3.0, kz=kk*dot(d,a);
    float p2=ky-kx*kx, p3=p2*p2*p2, q=kx*(2.0*kx*kx-3.0*ky)+kz;
    float h=q*q+4.0*p3, res;
    if (h>=0.0) {
        h=sqrt(h); vec2 x=(vec2(h,-h)-q)/2.0;
        vec2 uv2=sign(x)*pow(abs(x),vec2(1.0/3.0));
        float t2=clamp(uv2.x+uv2.y-kx,0.0,1.0);
        vec2 qos=d+(c+b*t2)*t2; res=dot(qos,qos);
    } else {
        float z=sqrt(-p2), v=acos(q/(p2*z*2.0))/3.0;
        float m=cos(v), n=sin(v)*1.732050808;
        vec3 t3=clamp(vec3(m+m,-n-m,n-m)*z-kx,0.0,1.0);
        float da=dot(d+(c+b*t3.x)*t3.x,d+(c+b*t3.x)*t3.x);
        float db=dot(d+(c+b*t3.y)*t3.y,d+(c+b*t3.y)*t3.y);
        res=min(da,db);
    }
    return sqrt(res);
}

mat2 rot2(float a){ float c=cos(a),s=sin(a); return mat2(c,s,-s,c); }
float fill(float d, float aa){ return smoothstep(aa,-aa,d); }
float smin(float a, float b, float k){ float h=clamp(0.5+0.5*(b-a)/k,0.0,1.0); return mix(b,a,h)-k*h*(1.0-h); }
float sdPad(vec2 p, vec2 c, float r){ vec2 q=p-c; q.y/=0.62; return sdCircle(q,r); }

void main() {
    vec2 uv = isf_FragNormCoord.xy * 2.0 - 1.0;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;
    float aa = 1.5 / min(RENDERSIZE.x, RENDERSIZE.y);

    float sc = show_body ? body_scale : 1.0;
    uv = uv / sc + vec2(0.0, show_body ? -0.28 : 0.0);

    float t = animate ? TIME : 0.0;

    // ---- BLINK ----
    float bp = mod(t * blink_rate, 5.0);
    float blinkAuto = 1.0 - smoothstep(0.0,0.06,bp)*(1.0-smoothstep(0.06,0.22,bp));
    float blink = animate ? blinkAuto : blink_t;

    // ---- BOB ----
    float bobManual = (bob_t - 0.5) * 2.0 * 0.030;
    float bobAuto   = animate ? sin(t*1.1)*(bob_amp*0.030) : 0.0;
    uv.y -= bobManual + bobAuto;
    if (mirror) uv.x = -uv.x;

    // ======================================================== HEAD + MUZZLE (Cocker: pear skull, salient organic muzzle)
    vec2 headP = uv;
    float _hy = uv.y; // original y for consistent smoothstep
    headP.y *= mix(1.05, 1.48, smoothstep(0.05, -0.22, _hy));
    headP.x *= mix(0.94, 0.84, smoothstep(0.05, -0.22, _hy));
    float head = sdCircle(headP, 0.40);
    // Organic ellipse muzzle — clearly protrudes below the pear skull
    vec2 muzzleP = uv - vec2(0.0, -0.235); muzzleP.x /= 0.80; muzzleP.y /= 0.62;
    float muzzle = sdCircle(muzzleP, 0.170);
    float headShape = smin(head, muzzle, 0.025);
    // Nasal bridge ridge (visible shadow at top of muzzle)
    float nasalRidge = sdBox(uv - vec2(0.0, -0.140), vec2(0.045, 0.012));
    // Discreet forelock wisp (single curved segment, not a pompom)
    float topknot = sdSegment(uv, vec2(-0.030, 0.380), vec2(0.030, 0.395)) - 0.008;

    // ======================================================== EARS (Cocker: low pivot, very long pendulous, fringed)
    vec2 earPivL = vec2(-0.37, -0.05);
    vec2 earPivR = vec2( 0.37, -0.05);
    float earManual = (ear_t - 0.5) * 2.0 * 0.10;
    float earAuto   = animate ? sin(t*1.1+0.3)*(ear_amp*0.10) : 0.0;
    float earAngle  = earManual + earAuto;
    vec2 uvEL = earPivL + rot2(-earAngle) * (uv - earPivL);
    vec2 uvER = earPivR + rot2( earAngle) * (uv - earPivR);
    // Teardrop ear, length ~ head height, narrow at top, wider at middle
    vec2 earLCenter = vec2(-0.34, -0.30);
    vec2 earRCenter = vec2( 0.34, -0.30);
    vec2 earLP = uvEL - earLCenter; earLP.y /= 1.25;
    float taperL = mix(0.52, 0.38, smoothstep(-0.30, 0.20, earLP.y));
    earLP.x /= taperL;
    float angL = atan(earLP.y, earLP.x);
    float fringeL = (angL < 0.0) ? 0.014 * sin(angL * 10.0) : 0.0;
    float earL = sdCircle(earLP, 0.28 + fringeL) - 0.022;
    vec2 earRP = uvER - earRCenter; earRP.y /= 1.25;
    float taperR = mix(0.52, 0.38, smoothstep(-0.30, 0.20, earRP.y));
    earRP.x /= taperR;
    float angR = atan(earRP.y, earRP.x);
    float fringeR = (angR < 0.0) ? 0.014 * sin(angR * 10.0) : 0.0;
    float earR = sdCircle(earRP, 0.28 + fringeR) - 0.022;
    // Short hatches on ear bottom edge (cartoon fur indication)
    float hatchL = min(min(
        sdSegment(uv, earPivL + vec2(-0.10,-0.50), earPivL + vec2(-0.07,-0.46)),
        sdSegment(uv, earPivL + vec2(-0.04,-0.52), earPivL + vec2(-0.01,-0.48))),
        sdSegment(uv, earPivL + vec2( 0.02,-0.50), earPivL + vec2( 0.05,-0.46)));
    float hatchR = min(min(
        sdSegment(uv, earPivR + vec2( 0.10,-0.50), earPivR + vec2( 0.07,-0.46)),
        sdSegment(uv, earPivR + vec2( 0.04,-0.52), earPivR + vec2( 0.01,-0.48))),
        sdSegment(uv, earPivR + vec2(-0.02,-0.50), earPivR + vec2(-0.05,-0.46)));
    // Inner ear (silky lighter patch, scales with ear)
    vec2 iEarLP = uvEL - earLCenter; iEarLP.x /= 0.28; iEarLP.y /= 1.30;
    float innerEarL = sdCircle(iEarLP, 0.19) - 0.012;
    vec2 iEarRP = uvER - earRCenter; iEarRP.x /= 0.28; iEarRP.y /= 1.30;
    float innerEarR = sdCircle(iEarRP, 0.19) - 0.012;

    // ---- Ear-skull fusion (unified silhouette) ----
    float earsCombined  = min(earL, earR);
    float headEarsUnion = smin(headShape, earsCombined, 0.045);

    // ---- GAZE toward bone (bY = -0.632 - neck_gap, boneCenter.y = bY - 0.36 + bone_y) ----
    vec2  bonePosForGaze = vec2(bone_x + bone_pan, -0.992 - neck_gap + bone_y);
    vec2  toBone         = bonePosForGaze - vec2(0.0, 0.05);
    float gazeDist       = max(length(toBone), 0.001);
    vec2  gazeDir        = show_bone ? (toBone / gazeDist) * min(gazeDist * 0.12, 0.014) : vec2(0.0);

    // ======================================================== EYES (Cocker: large, round, soulful)
    vec2 eyeLPos = vec2(-0.155, 0.050);
    vec2 eyeRPos = vec2( 0.155, 0.050);
    float eR = 0.095;
    vec2 eyePL = uv - eyeLPos; eyePL.x /= 0.88;
    vec2 eyePR = uv - eyeRPos; eyePR.x /= 0.88;
    float eyeL  = sdCircle(eyePL, eR);
    float eyeR2 = sdCircle(eyePR, eR);
    float breathe = animate ? 0.5+0.5*sin(t*0.5) : 0.5;
    float pupRad  = eR * clamp(0.32 + pupil_dilation*0.50 + breathe*0.06, 0.18, 0.84);
    float pupilL  = sdCircle(eyePL - gazeDir, pupRad);
    float pupilR2 = sdCircle(eyePR - gazeDir, pupRad);
    vec2  lidCL = eyeLPos + vec2(0.0, eR*2.3*blink);
    vec2  lidCR = eyeRPos + vec2(0.0, eR*2.3*blink);
    float lidL  = sdBox(uv - lidCL, vec2(eR*1.18, eR*1.12));
    float lidR2 = sdBox(uv - lidCR, vec2(eR*1.18, eR*1.12));
    // Iris radial gradient: bright caramel center, darker limbal ring
    float irisDistL = clamp(length(eyePL) / eR, 0.0, 1.0);
    float irisDistR = clamp(length(eyePR) / eR, 0.0, 1.0);
    vec3  irisColL  = mix(eye_color.rgb * 1.5, eye_color.rgb * 0.70, irisDistL);
    vec3  irisColR  = mix(eye_color.rgb * 1.5, eye_color.rgb * 0.70, irisDistR);
    // Primary catchlight: teardrop oval; secondary small catchlight bottom-right; both track gaze
    vec2  sh1PL = uv - eyeLPos - vec2(0.026, 0.028) - gazeDir; sh1PL.y /= 0.62;
    float shineL  = sdCircle(sh1PL, 0.024);
    float shine2L = sdCircle(uv - eyeLPos - vec2(0.032, -0.028) - gazeDir, 0.009);
    vec2  sh1PR = uv - eyeRPos - vec2(0.026, 0.028) - gazeDir; sh1PR.y /= 0.62;
    float shineR  = sdCircle(sh1PR, 0.024);
    float shine2R = sdCircle(uv - eyeRPos - vec2(0.032, -0.028) - gazeDir, 0.009);
    // Cocker brow ridges: slight arcs above each eye
    float browL  = sdCircle(uv - eyeLPos - vec2(0.0, 0.110), 0.020);
    float browR  = sdCircle(uv - eyeRPos - vec2(0.0, 0.110), 0.020);

    // ======================================================== NOSE (Cocker: wide, prominent)
    vec2 noseP = uv - vec2(0.0, -0.175); noseP.x /= 0.80;
    float nose = sdCircle(noseP, 0.068);
    float noseShine = sdCircle(uv - vec2(-0.022,-0.155), 0.013);

    // ======================================================== MOUTH + TONGUE
    float jawD = mouth_open * 0.06;
    vec2 mMid = vec2(0.0, -0.262);
    vec2 mCL  = mix(vec2(-0.078,-0.258), vec2(-0.094,-0.270+jawD), mouth_open);
    vec2 mCR  = mix(vec2( 0.078,-0.258), vec2( 0.094,-0.270+jawD), mouth_open);
    // Corner segments fade out as mouth opens
    float mouthCorners = min(sdSegment(uv, mMid, mCL), sdSegment(uv, mMid, mCR));
    // Cavity ellipse grows downward from mMid
    vec2  cavC  = mMid - vec2(0.0, mouth_open * 0.028);
    vec2  cavP  = uv - cavC; cavP.x /= 0.86;
    float mouthCavity = sdCircle(cavP, mouth_open * 0.062);
    float tongueR = mouth_open * 0.048;
    vec2  tongC   = cavC - vec2(0.0, mouth_open * 0.018);
    vec2  tongP   = uv - tongC; tongP.x /= 0.70;
    float tongue  = sdCircle(tongP, tongueR);

    // ======================================================== BODY
    float bY = -0.632 - neck_gap;
    float neckHalf = max(0.0, neck_gap * 0.5);
    float neck_sdf = sdBox(uv - vec2(0.0,(-0.352+bY+0.28)*0.5), vec2(0.120, neckHalf));
    vec2 bodyP = uv - vec2(0.0, bY); bodyP.x /= 0.78; bodyP.y /= 0.92;
    float body_sdf = sdCircle(bodyP, 0.30);
    // Poitrail saillant entre encolure et pattes
    vec2 chestP = uv - vec2(0.0, bY + 0.22); chestP.x /= 1.10; chestP.y /= 0.70;
    body_sdf = smin(body_sdf, sdCircle(chestP, 0.13), 0.04);

    // ---- TAIL ----
    float tailAngle = tail_t * 6.2832 + (animate ? t * 1.5 : 0.0);
    float tSwayH = tail_amp * 0.55 * cos(tailAngle);
    float tSwayV = tail_amp * 0.15 * sin(tailAngle);
    float tL     = tail_length;
    vec2  tRoot   = vec2(0.20, bY + 0.18);
    vec2  tailPiv = vec2(0.20, bY + 0.18 + tSwayV);
    vec2  uvT     = tailPiv + rot2(-tSwayH) * (uv - tailPiv);
    vec2 tA = tRoot;
    vec2 tB = tRoot + vec2(0.10,  0.20) * tL;
    vec2 tC = tRoot + vec2(0.02,  0.30) * tL;
    float tailW   = 0.036 + 0.012 * tL;
    float tail_sdf = sdBezier(uvT, tA, tB, tC) - tailW;
    float tailTip  = sdCircle(uvT - (2.0*tC - tB), tailW * 1.50);

    // ---- FRONT PAWS ----
    float pfAngle   = paw_f_t * 6.2832 + (animate ? t * 2.0 : 0.0);
    vec2  pfDelta   = paw_f_radius * vec2(cos(pfAngle), sin(pfAngle)*0.65);
    vec2  pfLCenter = vec2(-0.26-paw_f_spread+paw_f_l_x, bY-0.13+paw_f_l_y) + vec2(-pfDelta.x, pfDelta.y);
    vec2  pfRCenter = vec2( 0.26+paw_f_spread+paw_f_r_x, bY-0.13+paw_f_r_y) + pfDelta;
    vec2 pfLP = uv - pfLCenter; pfLP.y *= 0.72; pfLP.x *= 0.82;
    float pfL = sdCircle(pfLP, paw_f_size);
    vec2 pfRP = uv - pfRCenter; pfRP.y *= 0.72; pfRP.x *= 0.82;
    float pfR = sdCircle(pfRP, paw_f_size);
    float ps  = paw_f_size / 0.098;
    float pr  = 0.022 * ps;
    float toeL = min(min(
        sdPad(uv, pfLCenter+vec2(-0.038,-0.046)*ps, pr),
        sdPad(uv, pfLCenter+vec2( 0.000,-0.056)*ps, pr)),
        sdPad(uv, pfLCenter+vec2( 0.038,-0.046)*ps, pr));
    float toeR = min(min(
        sdPad(uv, pfRCenter+vec2(-0.038,-0.046)*ps, pr),
        sdPad(uv, pfRCenter+vec2( 0.000,-0.056)*ps, pr)),
        sdPad(uv, pfRCenter+vec2( 0.038,-0.046)*ps, pr));

    // ---- BACK PAWS ----
    float pbAngle   = paw_b_t * 6.2832 + (animate ? t * 2.5 : 0.0);
    vec2  pbDelta   = paw_b_radius * vec2(cos(pbAngle), sin(pbAngle)*0.55);
    vec2  pbLCenter = vec2(-0.13-paw_b_spread+paw_b_x, bY-0.31+paw_b_y) + vec2(-pbDelta.x, pbDelta.y);
    vec2  pbRCenter = vec2( 0.13+paw_b_spread+paw_b_x, bY-0.31+paw_b_y) + pbDelta;
    vec2 pbLP = uv - pbLCenter; pbLP.y *= 0.65;
    float pbL = sdCircle(pbLP, paw_b_size);
    vec2 pbRP = uv - pbRCenter; pbRP.y *= 0.65;
    float pbR = sdCircle(pbRP, paw_b_size);
    float pbs = paw_b_size / 0.092;
    float pbr = 0.020 * pbs;
    float toeBL = min(min(
        sdPad(uv, pbLCenter+vec2(-0.032,-0.038)*pbs, pbr),
        sdPad(uv, pbLCenter+vec2( 0.000,-0.046)*pbs, pbr)),
        sdPad(uv, pbLCenter+vec2( 0.032,-0.038)*pbs, pbr));
    float toeBR = min(min(
        sdPad(uv, pbRCenter+vec2(-0.032,-0.038)*pbs, pbr),
        sdPad(uv, pbRCenter+vec2( 0.000,-0.046)*pbs, pbr)),
        sdPad(uv, pbRCenter+vec2( 0.032,-0.038)*pbs, pbr));

    // ---- BELLY ----
    vec2 bellyP = uv - vec2(0.0, bY-0.04); bellyP.y *= 1.25;
    float belly = sdCircle(bellyP, 0.155);

    // ---- BONE ----
    float bsn     = bone_size / 0.06;
    float boneHL  = 0.095 * bsn;
    float knobR   = 0.036 * bsn;
    float knobOff = knobR  * 0.72;
    float shaftH  = 0.016 * bsn;
    vec2  boneCenter = vec2(bone_x + bone_pan, bY - 0.36 + bone_y);
    vec2  boneRel    = rot2(bone_angle * 3.14159) * (uv - boneCenter);
    float shaft   = sdBox(boneRel, vec2(boneHL, shaftH));
    float kL1 = sdCircle(boneRel - vec2(-boneHL,  knobOff), knobR);
    float kL2 = sdCircle(boneRel - vec2(-boneHL, -knobOff), knobR);
    float kR1 = sdCircle(boneRel - vec2( boneHL,  knobOff), knobR);
    float kR2 = sdCircle(boneRel - vec2( boneHL, -knobOff), knobR);
    float bone_sdf = min(min(shaft, min(kL1,kL2)), min(kR1,kR2));

    // ======================================================== COMPOSITING
    vec3 col = bg_color.rgb;
    float alpha = bg_color.a;
    vec3 fur = fur_color.rgb;
    float outW = outline_width;
    vec3  outC = outline_color.rgb;
    float fM;

    if (show_body) {
        fM = fill(tail_sdf - outW, aa);  col = mix(col, outC, fM);  alpha = max(alpha, fM);
        col = mix(col, fur,  fill(tail_sdf, aa));
        fM = fill(tailTip - outW, aa);   col = mix(col, outC, fM);  alpha = max(alpha, fM);
        col = mix(col, fur,  fill(tailTip, aa));
        fM = fill(pbL - outW, aa);       col = mix(col, outC, fM);  alpha = max(alpha, fM);
        col = mix(col, fur,  fill(pbL, aa));
        col = mix(col, mix(fur,outC,0.38), fill(toeBL,aa)*fill(pbL,aa));
        fM = fill(pbR - outW, aa);       col = mix(col, outC, fM);  alpha = max(alpha, fM);
        col = mix(col, fur,  fill(pbR, aa));
        col = mix(col, mix(fur,outC,0.38), fill(toeBR,aa)*fill(pbR,aa));
        fM = fill(neck_sdf - outW, aa);  col = mix(col, outC, fM);  alpha = max(alpha, fM);
        col = mix(col, fur,  fill(neck_sdf, aa));
        fM = fill(body_sdf - outW, aa);  col = mix(col, outC, fM);  alpha = max(alpha, fM);
        col = mix(col, fur,  fill(body_sdf, aa));
        col = mix(col, mix(fur,vec3(1.0),0.42), fill(belly,aa)*fill(body_sdf,aa));
    }

    // Fused skull-ear silhouette: single unified outline, fur base everywhere
    fM = fill(headEarsUnion - outW, aa);  col = mix(col, outC, fM);  alpha = max(alpha, fM);
    col = mix(col, fur,  fill(headEarsUnion, aa));
    // Ear zones: ear_color only outside the skull contour
    float inHead = fill(headShape, aa);
    col = mix(col, ear_color.rgb,        fill(earL, aa) * (1.0 - inHead));
    col = mix(col, ear_color.rgb * 0.78, fill(innerEarL, aa) * (1.0 - inHead));
    col = mix(col, outC, fill(hatchL - 0.003, aa)*fill(earL, aa));
    col = mix(col, ear_color.rgb,        fill(earR, aa) * (1.0 - inHead));
    col = mix(col, ear_color.rgb * 0.78, fill(innerEarR, aa) * (1.0 - inHead));
    col = mix(col, outC, fill(hatchR - 0.003, aa)*fill(earR, aa));
    // Muzzle lighter highlight
    col = mix(col, mix(fur,vec3(1.0),0.32), fill(muzzle,aa)*fill(headShape,aa));
    // Nasal bridge shadow
    col = mix(col, outC*0.55+fur*0.45, fill(nasalRidge-0.002,aa)*fill(headShape,aa));
    // Discreet forelock wisp
    col = mix(col, ear_color.rgb, fill(topknot, aa));

    // Eyes: iris gradient, gaze-tracked pupils, teardrop + secondary catchlight
    col = mix(col, irisColL, fill(eyeL,  aa));
    col = mix(col, irisColR, fill(eyeR2, aa));
    col = mix(col, vec3(0.05,0.03,0.01), fill(pupilL, aa)*fill(eyeL, aa)*blink);
    col = mix(col, vec3(0.05,0.03,0.01), fill(pupilR2,aa)*fill(eyeR2,aa)*blink);
    col = mix(col, vec3(1.00), fill(shineL,  aa)*fill(eyeL, aa)*blink);
    col = mix(col, vec3(0.78), fill(shine2L, aa)*fill(eyeL, aa)*blink);
    col = mix(col, vec3(1.00), fill(shineR,  aa)*fill(eyeR2,aa)*blink);
    col = mix(col, vec3(0.78), fill(shine2R, aa)*fill(eyeR2,aa)*blink);
    col = mix(col, fur, fill(lidL, aa)*fill(eyeL, aa));
    col = mix(col, fur, fill(lidR2,aa)*fill(eyeR2,aa));
    col = mix(col, fur*0.52, fill(browL-0.001,aa)*fill(headShape,aa));
    col = mix(col, fur*0.52, fill(browR-0.001,aa)*fill(headShape,aa));

    // Nose
    col = mix(col, vec3(0.08,0.04,0.03), fill(nose, aa));
    col = mix(col, vec3(0.52,0.36,0.32), fill(noseShine,aa)*fill(nose,aa));

    // Mouth + tongue: cavity opens downward, corners fade on open
    col = mix(col, vec3(0.08,0.03,0.05), fill(mouthCavity, aa)*fill(headShape,aa));
    col = mix(col, vec3(0.91,0.44,0.50), fill(tongue,      aa)*fill(headShape,aa));
    col = mix(col, vec3(0.20,0.07,0.09), fill(mouthCorners-0.0052,aa)*fill(headShape,aa)*(1.0-mouth_open*0.85));

    // Bone over head, under front paws
    if (show_bone) {
        fM = fill(bone_sdf - outW, aa);  col = mix(col, outC, fM);  alpha = max(alpha, fM);
        col = mix(col, bone_color.rgb, fill(bone_sdf, aa));
        col = mix(col, vec3(1.0), fill(sdBox(boneRel, vec2(boneHL*0.65, shaftH*0.28))-0.004, aa)*fill(bone_sdf,aa));
    }

    // Front paws on top
    if (show_body) {
        fM = fill(pfL - outW, aa);  col = mix(col, outC, fM);  alpha = max(alpha, fM);
        col = mix(col, fur,  fill(pfL, aa));
        col = mix(col, mix(fur,outC,0.38), fill(toeL,aa)*fill(pfL,aa));
        fM = fill(pfR - outW, aa);  col = mix(col, outC, fM);  alpha = max(alpha, fM);
        col = mix(col, fur,  fill(pfR, aa));
        col = mix(col, mix(fur,outC,0.38), fill(toeR,aa)*fill(pfR,aa));
    }

    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
