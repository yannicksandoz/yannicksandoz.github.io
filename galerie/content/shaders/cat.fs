/*{
  "DESCRIPTION": "Procedural cat — head and body with full manual + auto animation controls. v1.6",
  "CREDIT": "yr0-lab",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "fur_color",     "TYPE": "color", "DEFAULT": [0.78, 0.58, 0.38, 1.0] },
    { "NAME": "eye_color",     "TYPE": "color", "DEFAULT": [0.18, 0.72, 0.28, 1.0] },
    { "NAME": "bg_color",      "TYPE": "color", "DEFAULT": [0.05, 0.05, 0.12, 1.0] },
    { "NAME": "outline_color", "TYPE": "color", "DEFAULT": [0.30, 0.20, 0.10, 1.0] },
    { "NAME": "outline_width", "TYPE": "float", "DEFAULT": 0.013, "MIN": 0.0,   "MAX": 0.04  },
    { "NAME": "pupil_dilation","TYPE": "float", "DEFAULT": 0.4,   "MIN": 0.0,   "MAX": 1.0  },
    { "NAME": "mouth_open",    "TYPE": "float", "DEFAULT": 0.0,   "MIN": 0.0,   "MAX": 1.0  },
    { "NAME": "animate",       "TYPE": "bool",  "DEFAULT": true   },
    { "NAME": "blink_rate",    "TYPE": "float", "DEFAULT": 1.0,   "MIN": 0.2,   "MAX": 4.0  },
    { "NAME": "blink_t",       "TYPE": "float", "DEFAULT": 1.0,   "MIN": 0.0,   "MAX": 1.0  },
    { "NAME": "bob_amp",       "TYPE": "float", "DEFAULT": 0.5,   "MIN": 0.0,   "MAX": 1.0  },
    { "NAME": "bob_t",         "TYPE": "float", "DEFAULT": 0.5,   "MIN": 0.0,   "MAX": 1.0  },
    { "NAME": "ear_amp",       "TYPE": "float", "DEFAULT": 0.5,   "MIN": 0.0,   "MAX": 1.0  },
    { "NAME": "ear_t",         "TYPE": "float", "DEFAULT": 0.5,   "MIN": 0.0,   "MAX": 1.0  },
    { "NAME": "whisker_amp",   "TYPE": "float", "DEFAULT": 0.5,   "MIN": 0.0,   "MAX": 1.0  },
    { "NAME": "whisker_t",     "TYPE": "float", "DEFAULT": 0.5,   "MIN": 0.0,   "MAX": 1.0  },
    { "NAME": "tail_amp",      "TYPE": "float", "DEFAULT": 0.5,   "MIN": 0.0,   "MAX": 3.0  },
    { "NAME": "tail_t",        "TYPE": "float", "DEFAULT": 0.0,   "MIN": 0.0,   "MAX": 1.0  },
    { "NAME": "tail_middle_x", "TYPE": "float", "DEFAULT": 0.0,   "MIN": -1.0,  "MAX": 1.0  },
    { "NAME": "tail_length",   "TYPE": "float", "DEFAULT": 1.0,   "MIN": 0.2,   "MAX": 2.5  },
    { "NAME": "show_body",     "TYPE": "bool",  "DEFAULT": false  },
    { "NAME": "neck_gap",      "TYPE": "float", "DEFAULT": -0.10, "MIN": -0.20, "MAX": 0.28 },
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
    { "NAME": "show_ball",     "TYPE": "bool",  "DEFAULT": false  },
    { "NAME": "ball_color",    "TYPE": "color", "DEFAULT": [0.85, 0.15, 0.25, 1.0] },
    { "NAME": "ball_x",        "TYPE": "float", "DEFAULT": 0.0,   "MIN": -1.0,  "MAX": 1.0  },
    { "NAME": "ball_y",        "TYPE": "float", "DEFAULT": 0.0,   "MIN": -0.60, "MAX": 0.60 },
    { "NAME": "ball_pan",      "TYPE": "float", "DEFAULT": 0.0,   "MIN": -1.0,  "MAX": 1.0  },
    { "NAME": "ball_size",     "TYPE": "float", "DEFAULT": 0.062, "MIN": 0.02,  "MAX": 0.18 },
    { "NAME": "ball_roll",     "TYPE": "float", "DEFAULT": 0.0,   "MIN": 0.0,   "MAX": 1.0  },
    { "NAME": "ball_travel",   "TYPE": "float", "DEFAULT": 0.18,  "MIN": 0.0,   "MAX": 0.60 },
    { "NAME": "tail_tip_x",    "TYPE": "float", "DEFAULT": 0.0,   "MIN": -1.0,  "MAX": 1.0  },
    { "NAME": "tail_tip_y",    "TYPE": "float", "DEFAULT": 0.0,   "MIN": -0.40, "MAX": 0.40 },
    { "NAME": "tail_tip_size", "TYPE": "float", "DEFAULT": 0.028, "MIN": 0.01,  "MAX": 0.08 },
    { "NAME": "mirror",        "TYPE": "bool",  "DEFAULT": false  }
  ]
}*/

float sdCircle(vec2 p, float r) { return length(p) - r; }

float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d,0.0)) + min(max(d.x,d.y),0.0);
}

float sdTriangle(vec2 p, vec2 a, vec2 b, vec2 c) {
    vec2 e0=b-a, e1=c-b, e2=a-c;
    vec2 v0=p-a, v1=p-b, v2=p-c;
    vec2 pq0=v0-e0*clamp(dot(v0,e0)/dot(e0,e0),0.0,1.0);
    vec2 pq1=v1-e1*clamp(dot(v1,e1)/dot(e1,e1),0.0,1.0);
    vec2 pq2=v2-e2*clamp(dot(v2,e2)/dot(e2,e2),0.0,1.0);
    float s=sign(e0.x*e2.y-e0.y*e2.x);
    vec2 d=min(min(vec2(dot(pq0,pq0),s*(v0.x*e0.y-v0.y*e0.x)),
                   vec2(dot(pq1,pq1),s*(v1.x*e1.y-v1.y*e1.x))),
                   vec2(dot(pq2,pq2),s*(v2.x*e2.y-v2.y*e2.x)));
    return -sqrt(d.x)*sign(d.y);
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa=p-a, ba=b-a;
    return length(pa - ba*clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0));
}

float sdBezier(vec2 pos, vec2 A, vec2 B, vec2 C) {
    vec2 a=B-A, b=A-2.0*B+C, c=a*2.0, d=A-pos;
    float kk=1.0/dot(b,b);
    float kx=kk*dot(a,b);
    float ky=kk*(2.0*dot(a,a)+dot(d,b))/3.0;
    float kz=kk*dot(d,a);
    float p=ky-kx*kx, p3=p*p*p;
    float q=kx*(2.0*kx*kx-3.0*ky)+kz;
    float h=q*q+4.0*p3;
    float res;
    if (h>=0.0) {
        h=sqrt(h);
        vec2 x=(vec2(h,-h)-q)/2.0;
        vec2 uv2=sign(x)*pow(abs(x),vec2(1.0/3.0));
        float t2=clamp(uv2.x+uv2.y-kx,0.0,1.0);
        vec2 qos=d+(c+b*t2)*t2; res=dot(qos,qos);
    } else {
        float z=sqrt(-p);
        float v=acos(q/(p*z*2.0))/3.0;
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

    // ---- BOB ---- (wider range)
    float bobManual = (bob_t - 0.5) * 2.0 * 0.030;
    float bobAuto   = animate ? sin(t*1.1)*(bob_amp*0.030) : 0.0;
    uv.y -= bobManual + bobAuto;
    if (mirror) uv.x = -uv.x;

    // ======================================================== HEAD
    vec2 headP = uv; headP.y *= 1.08;
    float head = sdCircle(headP, 0.38);

    // ======================================================== EARS (wider range)
    vec2 earPivL = vec2(-0.205, 0.188);
    vec2 earPivR = vec2( 0.205, 0.188);
    float earManual = (ear_t - 0.5) * 2.0 * 0.20;
    float earAuto   = animate ? sin(t*2.1+0.5)*(ear_amp*0.20) : 0.0;
    float earAngle  = earManual + earAuto;
    vec2 uvEL = earPivL + rot2(-earAngle) * (uv - earPivL);
    vec2 uvER = earPivR + rot2( earAngle) * (uv - earPivR);
    float earL = sdTriangle(uvEL, vec2(-0.34,0.08), vec2(-0.205,0.42), vec2(-0.09,0.11));
    float earR = sdTriangle(uvER, vec2( 0.09,0.11), vec2( 0.205,0.42), vec2( 0.34,0.08));
    float ears = min(earL, earR);
    float innerEarL = sdTriangle(uvEL, vec2(-0.27,0.17), vec2(-0.205,0.37), vec2(-0.13,0.20));
    float innerEarR = sdTriangle(uvER, vec2( 0.13,0.20), vec2( 0.205,0.37), vec2( 0.27,0.17));

    // ======================================================== EYES
    vec2 eyeLPos = vec2(-0.135, 0.04);
    vec2 eyeRPos = vec2( 0.135, 0.04);
    float eR = 0.078;
    float eyeL  = sdCircle(uv - eyeLPos, eR);
    float eyeR2 = sdCircle(uv - eyeRPos, eR);
    float breathe = animate ? 0.5+0.5*sin(t*0.5) : 0.5;
    float slitW = clamp(mix(0.007,eR*0.82,pupil_dilation+breathe*0.14), 0.007, eR*0.88);
    float pupilL = sdBox(uv - eyeLPos, vec2(slitW, eR*0.86));
    float pupilR = sdBox(uv - eyeRPos, vec2(slitW, eR*0.86));
    float lidH  = eR * 1.12;
    vec2  lidCL = eyeLPos + vec2(0.0, eR*2.3*blink);
    vec2  lidCR = eyeRPos + vec2(0.0, eR*2.3*blink);
    float lidL  = sdBox(uv - lidCL, vec2(eR*1.18, lidH));
    float lidR2 = sdBox(uv - lidCR, vec2(eR*1.18, lidH));
    float shineL = sdCircle(uv - eyeLPos - vec2(0.022,0.026), 0.017);
    float shineR = sdCircle(uv - eyeRPos - vec2(0.022,0.026), 0.017);

    // ======================================================== NOSE
    float nose = sdTriangle(uv, vec2(-0.034,-0.072), vec2(0.0,-0.100), vec2(0.034,-0.072));

    // ======================================================== MOUTH + MEOW (aligned interior)
    float jawD = mouth_open * 0.065;
    vec2 mCL = mix(vec2(-0.068,-0.158), vec2(-0.096,-0.182-jawD), mouth_open);
    vec2 mCR = mix(vec2( 0.068,-0.158), vec2( 0.096,-0.182-jawD), mouth_open);
    vec2 mTL = vec2(-0.105, -0.145);
    vec2 mTR = vec2( 0.105, -0.145);
    float philtrum  = sdSegment(uv, vec2(0.0,-0.100), vec2(0.0,-0.130));
    float mouthL2   = sdSegment(uv, vec2(0.0,-0.130), mCL);
    float mouthLtip = sdSegment(uv, mCL, mTL);
    float mouthR2   = sdSegment(uv, vec2(0.0,-0.130), mCR);
    float mouthRtip = sdSegment(uv, mCR, mTR);
    float mouth = min(min(philtrum,mouthL2), min(mouthLtip,min(mouthR2,mouthRtip)));
    // Interior center tracks actual gap midpoint
    float mBotY    = mix(-0.158, -0.182 - jawD, mouth_open);
    float mCenterY = (-0.130 + mBotY) * 0.5;
    float mInteriorR = mouth_open * 0.055;
    vec2 mIntP = uv - vec2(0.0, mCenterY); mIntP.x /= 0.72;
    float mInterior = sdCircle(mIntP, mInteriorR);
    vec2 tongueP = uv - vec2(0.0, mCenterY - mInteriorR * 0.3); tongueP.x /= 0.68;
    float tongue = sdCircle(tongueP, mInteriorR * 0.65);

    // ======================================================== WHISKERS (wider range)
    vec2 wRootL = vec2(-0.048,-0.096);
    vec2 wRootR = vec2( 0.048,-0.096);
    float wManual = (whisker_t - 0.5) * 2.0 * 0.18;
    float wAuto   = animate ? sin(t*1.65)*(whisker_amp*0.18) : 0.0;
    float wSway   = wManual + wAuto;
    vec2 uvWL = wRootL + rot2(-wSway) * (uv - wRootL);
    vec2 uvWR = wRootR + rot2( wSway) * (uv - wRootR);
    float wL1=sdSegment(uvWL,wRootL,wRootL+vec2(-0.335, 0.032));
    float wL2=sdSegment(uvWL,wRootL,wRootL+vec2(-0.335, 0.000));
    float wL3=sdSegment(uvWL,wRootL,wRootL+vec2(-0.335,-0.040));
    float wR1=sdSegment(uvWR,wRootR,wRootR+vec2( 0.335, 0.032));
    float wR2=sdSegment(uvWR,wRootR,wRootR+vec2( 0.335, 0.000));
    float wR3=sdSegment(uvWR,wRootR,wRootR+vec2( 0.335,-0.040));
    float whiskers = min(min(wL1,wL2), min(wL3, min(min(wR1,wR2),wR3)));

    // ======================================================== FOREHEAD STRIPES
    float strM=sdSegment(uv, vec2( 0.000,0.22), vec2( 0.000,0.36));
    float strL=sdSegment(uv, vec2(-0.095,0.20), vec2(-0.065,0.34));
    float strR=sdSegment(uv, vec2( 0.095,0.20), vec2( 0.065,0.34));
    float stripes = min(strM, min(strL, strR));

    // ======================================================== BODY
    float bY = -0.632 - neck_gap;
    float neckHalf = max(0.0, neck_gap * 0.5);
    float neck_sdf = sdBox(uv - vec2(0.0, (-0.352+bY+0.28)*0.5), vec2(0.108, neckHalf));
    vec2 bodyP = uv - vec2(0.0, bY); bodyP.x /= 0.88;
    float body_sdf = sdCircle(bodyP, 0.28);

    // ---- TAIL: circular phase motion (wider range) ----
    float tailAngle = tail_t * 6.2832 + (animate ? t * 0.65 : 0.0);
    float tSwayH = tail_amp * 0.55 * cos(tailAngle);
    float tSwayV = tail_amp * 0.22 * sin(tailAngle);
    float tRX    = tail_middle_x;
    float tL     = tail_length;
    vec2  tRoot   = vec2(0.24 + tRX, bY);
    vec2  tailPiv = vec2(0.24 + tRX, bY + tSwayV);
    vec2  uvT     = tailPiv + rot2(-tSwayH) * (uv - tailPiv);
    vec2 tA = tRoot;
    vec2 tB = tRoot + vec2( 0.34, -0.04) * tL;
    vec2 tC = tRoot + vec2( 0.30, -0.22) * tL;
    vec2 tD = 2.0*tC - tB;
    vec2 tE = tRoot + vec2(-0.04, -0.30) * tL + vec2(tail_tip_x, tail_tip_y);
    float tailW    = tail_tip_size;
    float tail_sdf = min(sdBezier(uvT,tA,tB,tC)-tailW, sdBezier(uvT,tC,tD,tE)-tailW);
    float tailTip  = sdCircle(uvT - tE, tailW);

    // ---- FRONT PAWS (paw_f): visible side paws, wider stance ----
    float pfAngle    = paw_f_t * 6.2832 + (animate ? t * 2.0 : 0.0);
    vec2  pfDelta    = paw_f_radius * vec2(cos(pfAngle), sin(pfAngle) * 0.65);
    vec2  pfLCenter  = vec2(-0.26 - paw_f_spread + paw_f_l_x, bY - 0.13 + paw_f_l_y) + vec2(-pfDelta.x, pfDelta.y);
    vec2  pfRCenter  = vec2( 0.26 + paw_f_spread + paw_f_r_x, bY - 0.13 + paw_f_r_y) + pfDelta;
    vec2 pfLP = uv - pfLCenter; pfLP.y *= 0.72; pfLP.x *= 0.82;
    float pfL = sdCircle(pfLP, paw_f_size);
    vec2 pfRP = uv - pfRCenter; pfRP.y *= 0.72; pfRP.x *= 0.82;
    float pfR = sdCircle(pfRP, paw_f_size);
    // Toes on front paws, scale with size
    float ps = paw_f_size / 0.098;
    float toeL = min(min(
        sdSegment(uv, pfLCenter+vec2(-0.055,-0.02)*ps, pfLCenter+vec2(-0.055,-0.07)*ps),
        sdSegment(uv, pfLCenter+vec2( 0.000,-0.03)*ps, pfLCenter+vec2( 0.000,-0.08)*ps)),
        sdSegment(uv, pfLCenter+vec2( 0.055,-0.02)*ps, pfLCenter+vec2( 0.055,-0.07)*ps));
    float toeR = min(min(
        sdSegment(uv, pfRCenter+vec2(-0.055,-0.02)*ps, pfRCenter+vec2(-0.055,-0.07)*ps),
        sdSegment(uv, pfRCenter+vec2( 0.000,-0.03)*ps, pfRCenter+vec2( 0.000,-0.08)*ps)),
        sdSegment(uv, pfRCenter+vec2( 0.055,-0.02)*ps, pfRCenter+vec2( 0.055,-0.07)*ps));

    // ---- BACK PAWS (paw_b): tucked bottom paws ----
    float pbAngle    = paw_b_t * 6.2832 + (animate ? t * 2.5 : 0.0);
    vec2  pbDelta    = paw_b_radius * vec2(cos(pbAngle), sin(pbAngle) * 0.55);
    vec2  pbLCenter  = vec2(-0.13 - paw_b_spread + paw_b_x, bY - 0.31 + paw_b_y) + vec2(-pbDelta.x, pbDelta.y);
    vec2  pbRCenter  = vec2( 0.13 + paw_b_spread + paw_b_x, bY - 0.31 + paw_b_y) + pbDelta;
    vec2 pbLP = uv - pbLCenter; pbLP.y *= 0.65;
    float pbL = sdCircle(pbLP, paw_b_size);
    vec2 pbRP = uv - pbRCenter; pbRP.y *= 0.65;
    float pbR = sdCircle(pbRP, paw_b_size);
    float pbs = paw_b_size / 0.092;
    float toeBL = min(min(
        sdSegment(uv, pbLCenter+vec2(-0.045,-0.02)*pbs, pbLCenter+vec2(-0.045,-0.06)*pbs),
        sdSegment(uv, pbLCenter+vec2( 0.000,-0.03)*pbs, pbLCenter+vec2( 0.000,-0.07)*pbs)),
        sdSegment(uv, pbLCenter+vec2( 0.045,-0.02)*pbs, pbLCenter+vec2( 0.045,-0.06)*pbs));
    float toeBR = min(min(
        sdSegment(uv, pbRCenter+vec2(-0.045,-0.02)*pbs, pbRCenter+vec2(-0.045,-0.06)*pbs),
        sdSegment(uv, pbRCenter+vec2( 0.000,-0.03)*pbs, pbRCenter+vec2( 0.000,-0.07)*pbs)),
        sdSegment(uv, pbRCenter+vec2( 0.045,-0.02)*pbs, pbRCenter+vec2( 0.045,-0.06)*pbs));

    // ---- BELLY ----
    vec2 bellyP = uv - vec2(0.0, bY-0.04); bellyP.y *= 1.25;
    float belly = sdCircle(bellyP, 0.155);

    // ---- BALL OF WOOL: ball_x = LFO, ball_pan = static offset, ball_roll = rotation LFO ----
    vec2  ballCenter = vec2(ball_x + ball_pan, bY - 0.36 + ball_y);
    float bs         = ball_size / 0.062;
    vec2  bRel       = uv - ballCenter;
    float ballSdf    = sdCircle(bRel, ball_size);
    // rolling without slip: one full rotation per ball_travel distance travelled
    float rollAngle  = ball_roll * 2.0 * ball_travel / max(ball_size, 0.001);
    vec2  bRelN      = rot2(rollAngle) * (bRel / bs);
    float yarnA = (sdSegment(bRelN, vec2(-0.052,-0.016), vec2( 0.052, 0.016)) - 0.009) * bs;
    float yarnB = (sdSegment(bRelN, vec2(-0.038, 0.038), vec2( 0.038,-0.038)) - 0.009) * bs;
    float yarnC = (sdSegment(bRelN, vec2(-0.052, 0.000), vec2( 0.052, 0.000)) - 0.007) * bs;
    float yarn   = min(min(yarnA,yarnB),yarnC);
    float ballShine = sdCircle(bRelN - vec2(0.018,0.018), 0.014) * bs;

    // ======================================================== COMPOSITING
    // Draw order: body-bg → head+face → ball (over head) → front paws (over ball)
    vec3 col = bg_color.rgb;
    float alpha = bg_color.a;
    vec3 fur = fur_color.rgb;
    float outW = outline_width;
    vec3 outlineCol = outline_color.rgb;
    float fM;

    if (show_body) {
        // Tail with outline
        fM = fill(tail_sdf - outW, aa);  col = mix(col, outlineCol, fM);  alpha = max(alpha, fM);
        col = mix(col, fur, fill(tail_sdf, aa));
        fM = fill(tailTip - outW, aa);   col = mix(col, outlineCol, fM);  alpha = max(alpha, fM);
        col = mix(col, fur, fill(tailTip, aa));
        // Back paws behind body, with outline + toes
        fM = fill(pbL - outW, aa);       col = mix(col, outlineCol, fM);  alpha = max(alpha, fM);
        col = mix(col, fur, fill(pbL, aa));
        col = mix(col, fur*0.55, fill(toeBL-0.004,aa)*fill(pbL,aa));
        fM = fill(pbR - outW, aa);       col = mix(col, outlineCol, fM);  alpha = max(alpha, fM);
        col = mix(col, fur, fill(pbR, aa));
        col = mix(col, fur*0.55, fill(toeBR-0.004,aa)*fill(pbR,aa));
        // Neck + body with outline
        fM = fill(neck_sdf - outW, aa);  col = mix(col, outlineCol, fM);  alpha = max(alpha, fM);
        col = mix(col, fur, fill(neck_sdf, aa));
        fM = fill(body_sdf - outW, aa);  col = mix(col, outlineCol, fM);  alpha = max(alpha, fM);
        col = mix(col, fur, fill(body_sdf, aa));
        col = mix(col, mix(fur,vec3(1.0),0.45), fill(belly,aa)*fill(body_sdf,aa));
    }

    // Head + ears + face (below ball and front paws)
    fM = fill(min(head,ears) - outW, aa);  col = mix(col, outlineCol, fM);  alpha = max(alpha, fM);
    col = mix(col, fur, fill(min(head,ears), aa));
    col = mix(col, vec3(0.96,0.60,0.68), fill(innerEarL, aa));
    col = mix(col, vec3(0.96,0.60,0.68), fill(innerEarR, aa));
    col = mix(col, fur*0.55, fill(stripes-0.006,aa)*fill(head,aa));
    col = mix(col, eye_color.rgb, fill(eyeL,  aa));
    col = mix(col, eye_color.rgb, fill(eyeR2, aa));
    col = mix(col, vec3(0.03,0.02,0.04), fill(pupilL,aa)*fill(eyeL, aa)*blink);
    col = mix(col, vec3(0.03,0.02,0.04), fill(pupilR,aa)*fill(eyeR2,aa)*blink);
    col = mix(col, vec3(1.0), fill(shineL,aa)*fill(eyeL, aa)*blink);
    col = mix(col, vec3(1.0), fill(shineR,aa)*fill(eyeR2,aa)*blink);
    col = mix(col, fur, fill(lidL, aa)*fill(eyeL, aa));
    col = mix(col, fur, fill(lidR2,aa)*fill(eyeR2,aa));
    col = mix(col, vec3(0.90,0.38,0.50), fill(nose, aa));
    col = mix(col, vec3(0.11,0.03,0.05), fill(mInterior,aa)*fill(head,aa));
    col = mix(col, vec3(0.91,0.44,0.50), fill(tongue,   aa)*fill(head,aa));
    col = mix(col, vec3(0.28,0.10,0.14), fill(mouth-0.0052,aa)*fill(head,aa));
    fM = fill(whiskers-0.0028,aa);  col = mix(col, vec3(0.95,0.95,0.98), fM);  alpha = max(alpha, fM);

    // Ball over head, under front paws
    if (show_ball) {
        fM = fill(ballSdf, aa);  col = mix(col, ball_color.rgb, fM);  alpha = max(alpha, fM);
        col = mix(col, ball_color.rgb*0.60, fill(yarn,aa)*fill(ballSdf,aa));
        col = mix(col, vec3(1.0), fill(ballShine,aa)*fill(ballSdf,aa));
    }

    // Front paws on top of ball
    if (show_body) {
        fM = fill(pfL - outW, aa);  col = mix(col, outlineCol, fM);  alpha = max(alpha, fM);
        col = mix(col, fur, fill(pfL, aa));
        col = mix(col, fur*0.55, fill(toeL-0.004,aa)*fill(pfL,aa));
        fM = fill(pfR - outW, aa);  col = mix(col, outlineCol, fM);  alpha = max(alpha, fM);
        col = mix(col, fur, fill(pfR, aa));
        col = mix(col, fur*0.55, fill(toeR-0.004,aa)*fill(pfR,aa));
    }

    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
