// UM982 타워형 하우징 (OpenSCAD) — 보드를 세워 넣고 안테나를 윗판에 직결. um982_tower.py 를 옮긴 파라메트릭 파일(초안).
// 사용: OpenSCAD(무료)에서 열기 → 아래 part 선택 → F5(미리보기) / F6(렌더) → 파일 ▸ 내보내기 ▸ STL
// 좌표: 원점 = 원판 윗면 중심, z 위쪽. 앞(덮개) = -y, 뒤 = +y. 보드: 길이 방향 = z (SMA 위), 폭 방향 = x (J1 이 +x), 부품면이 앞(-y).
// ※ 아직 출력·조립해 보지 않은 초안입니다. 확인이 필요한 값은 아래 "가정" 항목입니다.

$fn = 64;

// ===== 무엇을 만들까 =====
// "body_print"  : 본체, 출력 자세(윗판이 베드, 나사가 위)
// "cover_print" : 앞 덮개, 출력 자세(세워서)
// "body"        : 본체, 조립 자세
// "cover"       : 앞 덮개, 조립 자세
// "assembly"    : 본체 + 덮개 (확인용)
// "section"     : 앞뒤 단면(확인용, 본체+덮개를 y=-3.8 에서 자름)
part = "assembly";

// ===== 보드 실측 (mm) — um982_case 와 같음 =====
L = 50.23;  W = 31.80;
hole_pitch = [44.9, 27.2];         // 보드 고정 구멍 간격 (길이 방향, 폭 방향)
sma_out = 8.0;                     // SMA 가 기판 끝 밖으로 나온 길이

// ===== 가정 — 실물 확인 후 고칠 값 =====
neck_len = 13.0;                   // 안테나 바닥 아래로 나오는 나사산 목(Ø20)의 길이  ← 자로 재서 입력
usb_below = 14.0;                  // 보드 아래 끝 ~ 바닥: 직각(L자) USB-C 플러그가 들어갈 높이. 일자 케이블이면 약 28
plug_over = 7.0;                   // SMA 플러그가 보드 끝(+8)보다 더 올라오는 길이
bend = 6.0;                        // 안테나 케이블 굽힘 여유

// ===== 하우징 =====
r_out = 26.0;  r_in = 22.0;        // 바깥/안쪽 반지름 (안테나 귀 끝 반지름 24.9 를 덮음)
floor_t = 3.0;                     // 바닥 두께
y_back = 6.0;                      // 뒷벽 받침면 y
y_cover = -11.0;                   // 덮개 안쪽 면 y (SMA 플러그 안전 반경 4.6 이 닿지 않게)
hs = 4.0;                          // 보드 받침 길이 (아래 핀 3 + 여유 1)
post_d = 4.4;  pilot_m2 = 1.7;     // 보드 받침 지름 / M2 밑구멍 (M2 x 6)

// ===== 윗판 (안테나 체결) =====
plate_t = 10.0;                    // 윗판 두께
neck_hole_d = 22.0;                // 안테나 목 + 케이블이 지나는 가운데 구멍 (목 Ø20 + 여유)
ear = 40 / sqrt(2) / 2;            // 안테나 M3 구멍 위치(±14.142): 간격 28.28 = 볼트 원 Ø40 위 정사각
pilot_d = 2.8;  pilot_depth = 8.0; // M3 셀프탭 밑구멍 (열압입 인서트를 쓰면 Ø4.2, 깊이 6)

// ===== 앞 덮개 =====
cover_x = 21.4;                    // 덮개 나사 x 위치(좌우)
cover_z = [10, 35, 60, 85];        // 덮개 나사 높이들
cover_hole_d = 3.4;  cover_cb_d = 6.0;  cover_cb = 1.8;    // 관통구멍, 머리 자리 지름/깊이
cover_pilot_d = 2.6;  cover_pilot = 5.5;                    // 본체 쪽 밑구멍 (M3 x 8)
usb_slot = [20.0, 12.0];           // USB 케이블 슬롯 (폭 x, 높이 z)

// ===== 바닥 나사 (원판 중앙 5/8"-11 구멍으로) =====
stud_len = 7.0;
stud_major = 25.4 * 5 / 8;
stud_pitch = 25.4 / 11;
stud_clear = 0.35;                 // 프린트 공차 (헐거우면 올리고, 안 들어가면 내림)
right_hand = true;

// ===== 파생 값 (건드리지 않아도 됨) =====
z_b = floor_t + usb_below;         // 보드 아래 끝
z_t = z_b + L;                     // 보드 위 끝
z_pl = z_t + sma_out + plug_over + bend + (neck_len - plate_t);   // 윗판 아랫면
z_top = z_pl + plate_t;            // 안테나 바닥(윗판 윗면)
y_pcb = y_back - hs;               // 기판 바닥(핀 쪽)면 y
coil_z0 = z_t + 4.0;               // 케이블 감는 구간 시작
holes = [for (sx = [-1, 1]) for (k = [0, 1]) [sx * hole_pitch[1] / 2, z_b + (L - hole_pitch[0]) / 2 + k * hole_pitch[0]]];   // (x, z)

// ===== 도구 =====
module cylz(x, y, r, za, zb, f = 48) { translate([x, y, za]) cylinder(h = zb - za, r = r, $fn = f); }
module cyly(x, z, r, y0, y1, f = 32) { translate([x, y0, z]) rotate([-90, 0, 0]) cylinder(h = y1 - y0, r = r, $fn = f); }
module boxz(x0, x1, y0, y1, za, zb) { translate([x0, y0, za]) cube([x1 - x0, y1 - y0, zb - za]); }

// ===== 5/8"-11 수나사 (한 바퀴 단면을 비틀어 올림) =====
function prof(u) =
    u < 0.08 ? 0 : u < 0.42 ? (u - 0.08) / 0.34 : u < 0.58 ? 1 : u < 0.92 ? 1 - (u - 0.58) / 0.34 : 0;

module stud() {
    depth = 1.35;
    rmaj = (stud_major - stud_clear) / 2;
    rmin = rmaj - depth;
    n = 96;
    h = stud_len + 0.5;
    pts = [for (i = [0 : n - 1]) let(th = 360 * i / n, u = (((-th / 360) % 1) + 1) % 1, r = rmin + depth * prof(u)) [r * cos(th), r * sin(th)]];
    intersection() {
        translate([0, 0, -stud_len])
            linear_extrude(height = h, twist = (right_hand ? -1 : 1) * 360 * h / stud_pitch, slices = ceil(h / 0.1), convexity = 10)
                polygon(pts);
        translate([0, 0, -stud_len]) cylinder(h = h, r1 = rmin - 0.3, r2 = rmin - 0.3 + 1.2 * h);   // 끝단 모따기
    }
}

// ===== 본체 =====
module body() {
    union() {
        difference() {
            union() {
                difference() {                                                    // 원통 껍질
                    cylz(0, 0, r_out, 0, z_top, 128);
                    cylz(0, 0, r_in, floor_t, z_pl, 128);
                }
                intersection() {                                                  // 뒷벽 받침: 보드 구간만 평평하게 채움
                    cylz(0, 0, r_in + 0.01, z_b - 2.0, z_t + 4.0, 128);
                    boxz(-r_out, r_out, y_back, r_out, 0, z_top);
                }
                for (h = holes) cyly(h[0], h[1], post_d / 2, y_pcb, y_back + 0.01);   // 보드 받침
            }
            for (h = holes) cyly(h[0], h[1], pilot_m2 / 2, y_pcb - 0.01, y_pcb + 3.5, 24);   // M2 밑구멍
            cylz(0, 0, neck_hole_d / 2, z_pl - 0.01, z_top + 1, 64);                           // 안테나 목 구멍
            for (sx = [-1, 1]) for (sy = [-1, 1]) cylz(sx * ear, sy * ear, pilot_d / 2, z_top - pilot_depth, z_top + 0.01, 24);   // 안테나 M3 밑구멍
            boxz(-r_out - 1, r_out + 1, -r_out - 1, y_cover, floor_t, z_pl);                   // 덮개가 들어갈 앞쪽을 비움
            for (sx = [-1, 1]) for (z = cover_z) cyly(sx * cover_x, z, cover_pilot_d / 2, y_cover - 0.01, y_cover + cover_pilot, 24);   // 덮개 나사 밑구멍
        }
        stud();
    }
}

// ===== 앞 덮개 =====
module cover() {
    zc = z_b - usb_below / 2 - 1.0;
    difference() {
        intersection() {
            cylz(0, 0, r_out, 0, z_top, 128);
            boxz(-r_out - 1, r_out + 1, -r_out - 1, y_cover, floor_t, z_pl);
        }
        cylz(0, 0, r_in, coil_z0, z_pl + 1, 128);                                              // 케이블 감는 구간은 속을 비움
        for (sx = [-1, 1]) for (z = cover_z) {
            x = sx * cover_x;
            ys = -sqrt(r_out * r_out - x * x);                                                 // 이 x 에서 바깥 표면 y
            cyly(x, z, cover_hole_d / 2, -r_out - 1, y_cover + 0.01, 24);                      // 관통구멍
            cyly(x, z, cover_cb_d / 2, -r_out - 1, ys + cover_cb, 32);                         // 머리 자리
        }
        boxz(-usb_slot[0] / 2 + 0.1, usb_slot[0] / 2 + 0.1, -r_out - 1, y_cover + 0.5, zc - usb_slot[1] / 2, zc + usb_slot[1] / 2);   // USB 슬롯
    }
}

// ===== 선택 =====
if (part == "body_print") translate([0, 0, z_top]) rotate([180, 0, 0]) body();
else if (part == "cover_print") translate([0, 0, -floor_t]) cover();
else if (part == "body") body();
else if (part == "cover") cover();
else if (part == "assembly") { body(); translate([0, -6, 0]) cover(); }
else if (part == "section") difference() { union() { body(); cover(); } translate([-60, -3.8, -20]) cube([120, 100, 200]); }
