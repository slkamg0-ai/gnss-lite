// UM982 일체형 하우징 (OpenSCAD) — 폴 → 원판 → [하우징 + 안테나 직결]. um982_mount.py 를 옮긴 파라메트릭 파일.
// 뚜껑 윗판에 안테나를 M3 4개로 직접 체결하고, 뚜껑 아랫면은 안테나 케이블 보관용 원형 오목부입니다(어댑터·너트 없음).
// 사용: OpenSCAD(무료) 에서 열기 → 아래 part 선택 → F5(미리보기) / F6(렌더) → 파일 ▸ 내보내기 ▸ STL
// 좌표: 원점 = 원판 윗면 중심, z 위쪽. 앞(SMA 쪽) = -y, 뒤(USB 쪽) = +y.
// ※ 이 파일은 OpenSCAD 에서 직접 렌더해 보지 못했습니다(Python 판은 검증). 오류가 나면 알려주세요.
// ※ 나사산은 오른나사로 만들었지만 실제 체결은 thread_test.stl 로 먼저 확인하세요.

$fn = 64;

// ===== 무엇을 만들까 =====
// "body_print" : 본체, 출력 자세(뒤집어서 열린 쪽이 베드, 나사가 위)
// "lid_print"  : 뚜껑, 출력 자세(바닥면이 베드)
// "body"       : 본체, 조립 자세
// "lid"        : 뚜껑, 조립 자세
// "assembly"   : 본체 + 뚜껑(확인용)
part = "assembly";

// ===== 보드 실측 (mm) — um982_case 와 같음 =====
L = 50.23;  W = 31.80;  pcb_t = 1.6;
hmax = 11.4;                       // 기판 바닥에서 최고 높이
hs = 4.0;                          // 받침 높이
hole_pitch = [44.9, 27.2];         // 고정 구멍 중심 간격
sma_axis = 8.2;                    // SMA 중심 높이 (기판 바닥 기준)
usb_y = 16.0;  usb_h = 3.25;       // USB-C 중심 y, 커넥터 높이

// ===== 하우징 =====
r_out = 39.0;  r_in = 37.0;        // 바깥/안쪽 반지름 (원판 지름 100 보다 작게)
floor_t = 3.0;                     // 바닥 두께
top_clear = 1.5;                   // 최고 부품 위 여유
post_d = 4.4;  pilot_d = 1.7;      // 보드 받침 지름 / 나사 밑구멍 (M2 x 6)
boss_xy = 22.6;  boss_d = 8.0;  boss_pilot_d = 2.6;  boss_pilot_depth = 8.0;   // 뚜껑 나사 기둥(대각선 4곳, M3 x 20)
usb_open = [14.0, 7.0];            // 뒤 USB 구멍 (폭, 높이)
sma_slot_w = 28.0;                 // 앞 SMA 슬롯 폭 (위로 열려 뚜껑이 덮음)

// ===== 바닥 나사 (원판 중앙 5/8"-11 구멍으로) =====
stud_len = 7.0;
stud_major = 25.4 * 5 / 8;
stud_pitch = 25.4 / 11;
stud_clear = 0.35;                 // 프린트 공차 (헐거우면 올리고, 안 들어가면 내림)
right_hand = true;                 // false 로 하면 왼나사

// ===== 뚜껑 (안테나를 윗판에 직접 체결) =====
plate_t = 10.0;                    // 윗판 두께 (안테나 M3 밑구멍 깊이 8 + 여유)
store_depth = 12.0;                // 케이블 보관 오목부 깊이 (클수록 공간↑, 안테나 바닥이 높아짐)
store_r = 35.0;                    // 케이블 보관 오목부 반지름 (본체 안쪽 반지름 r_in=37 보다 2 작게; 더 넓히려면 r_in 쪽으로)
neck_hole_d = 22.0;                // 안테나 목(Ø20) + 케이블이 지나는 가운데 구멍
chan_w = 28.0;                     // 오목부와 앞 SMA 슬롯을 잇는 통로 폭
ear = 40 / sqrt(2) / 2;            // 안테나 M3 구멍 위치(±14.142): 간격 28.28 = 볼트 원 Ø40 위 정사각 (도면과 일치)
ant_pilot_d = 2.8;  ant_pilot_depth = 8.0;   // 안테나 M3 셀프탭 밑구멍 (열압입 인서트를 쓰면 Ø4.2, 깊이 6)
lid_hole_d = 3.4;  lid_cb_d = 6.0;  lid_cb_depth = 3.0;   // 뚜껑을 본체에 조이는 M3 x 25 의 구멍 / 머리 자리

// ===== 파생 값 (건드리지 않아도 됨) =====
z0 = floor_t;
pcb_b = z0 + hs;
pcb_top = pcb_b + pcb_t;
hi = pcb_b + hmax;
zc = hi + top_clear;               // 본체 위끝 = 뚜껑 아랫면
lid_t = plate_t + store_depth;
top = zc + lid_t;
hl = L / 2;  hw = W / 2;
holes = [for (sx = [-1, 1]) for (sy = [-1, 1]) [sx * hole_pitch[0] / 2, sy * hole_pitch[1] / 2]];   // 보드 중심 기준
boss_pts = [for (sx = [-1, 1]) for (sy = [-1, 1]) [sx * boss_xy, sy * boss_xy]];
usb_c = usb_y - hw;                // 보드 좌표 y (중심 기준)

// ===== 도구 =====
module cylz(x, y, r, za, zb, f = 48) { translate([x, y, za]) cylinder(h = zb - za, r = r, $fn = f); }
module boxz(x0, x1, y0, y1, za, zb) { translate([x0, y0, za]) cube([x1 - x0, y1 - y0, zb - za]); }

// ===== 5/8"-11 수나사 (한 바퀴 단면을 비틀어 올림) =====
function prof(u) =   // 60° 사다리꼴 산: 골 0.08 / 오르막 0.34 / 마루 0.16 / 내리막 0.34 / 골 0.08
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
    zu = pcb_top + usb_h / 2;
    zs = pcb_b + sma_axis;
    rotate([0, 0, -90])                     // 보드 +x(SMA) → 앞(-y)
    union() {
        difference() {
            union() {
                difference() {
                    cylz(0, 0, r_out, 0, zc, 128);
                    cylz(0, 0, r_in, z0, zc + 1, 128);
                }
                for (h = holes) cylz(h[0], h[1], post_d / 2, z0 - 0.01, z0 + hs);              // 보드 받침
                for (b = boss_pts) cylz(b[0], b[1], boss_d / 2, z0 - 0.01, zc);                // 뚜껑 나사 기둥
            }
            for (h = holes) cylz(h[0], h[1], pilot_d / 2, z0 + 0.4, z0 + hs + 0.01, 24);       // 보드 나사 밑구멍
            for (b = boss_pts) cylz(b[0], b[1], boss_pilot_d / 2, zc - boss_pilot_depth, zc + 0.01, 24);
            boxz(-r_out - 1, -hl - 2, usb_c - usb_open[0] / 2, usb_c + usb_open[0] / 2, zu - usb_open[1] / 2, zu + usb_open[1] / 2);   // 뒤 USB 구멍
            boxz(hl + 3, r_out + 1, -sma_slot_w / 2, sma_slot_w / 2, zs - 6.2, zc + 0.01);     // 앞 SMA 슬롯
        }
        stud();
    }
}

// ===== 뚜껑 (조립 자세) =====
module lid() {
    difference() {
        cylz(0, 0, r_out, zc, top, 128);
        // 케이블 보관 오목부(아래에서 열림): 큰 원형, 뚜껑 나사 4곳 둘레만 기둥으로 남김
        difference() {
            cylz(0, 0, store_r, zc - 0.01, zc + store_depth, 128);
            for (b = boss_pts) cylz(b[0], b[1], boss_d / 2 + 0.6, zc - 1, zc + store_depth + 1, 32);
        }
        boxz(-chan_w / 2, chan_w / 2, -r_out - 1, -20, zc - 0.01, zc + store_depth);             // 앞(-y) 통로: 오목부와 SMA 슬롯 연결
        cylz(0, 0, neck_hole_d / 2, zc + store_depth - 0.01, top + 1, 64);                      // 안테나 목·케이블이 지나는 가운데 구멍
        for (sx = [-1, 1]) for (sy = [-1, 1]) cylz(sx * ear, sy * ear, ant_pilot_d / 2, top - ant_pilot_depth, top + 0.01, 24);   // 안테나 M3 밑구멍
        for (b = boss_pts) cylz(b[0], b[1], lid_hole_d / 2, zc - 1, top + 1, 24);               // 뚜껑 M3 구멍
        for (b = boss_pts) cylz(b[0], b[1], lid_cb_d / 2, top - lid_cb_depth, top + 1, 32);     // 머리 자리
    }
}

// ===== 선택 =====
if (part == "body_print") translate([0, 0, zc]) rotate([180, 0, 0]) body();
else if (part == "lid_print") translate([0, 0, -zc]) lid();
else if (part == "body") body();
else if (part == "lid") lid();
else if (part == "assembly") { body(); translate([0, 0, 12]) lid(); }
