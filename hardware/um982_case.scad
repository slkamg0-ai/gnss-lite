// UM982 보드 케이스 (OpenSCAD) — 숫자만 고쳐서 쓰는 파라메트릭 파일
// 사용: OpenSCAD(무료) 에서 열기 → 아래 part 를 고르기 → F5(미리보기) / F6(렌더) → 파일 ▸ 내보내기 ▸ STL
// 좌표(조립 상태): 원점 = 기판 왼쪽 아래 모서리. USB-C 가 왼쪽, SMA 가 오른쪽(J1 = 위쪽), x = 길이, y = 폭, z = 위.
// ※ 이 파일은 Python 설계(um982_case.py)를 옮긴 것이며 OpenSCAD 에서 직접 렌더해 보지는 못했습니다. 오류가 나면 알려주세요.

$fn = 48;

// ===== 무엇을 만들까 =====
// "pad_base"   : 평면 부착형 본체 (바닥 벨크로 자리)
// "strap_base" : 스트랩형 본체 (바닥 밑 스트랩 터널)
// "lid"        : 뚜껑, 출력 자세(바깥면이 베드)
// "lid_asm"    : 뚜껑, 조립 자세 (확인용)
// "assembly"   : 본체 + 띄운 뚜껑 (확인용)
part = "pad_base";
kind_for_lid = "pad";          // 뚜껑 모양은 pad/strap 에서 같음(높이 기준만 다름)

// ===== 보드 실측 (mm) =====
L = 50.23;  W = 31.80;  pcb_t = 1.6;
hmax = 11.4;                    // 기판 바닥에서 최고 높이
hs = 4.0;                       // 받침 높이 (아래 핀 3 + 여유 1)
hole_pitch = [44.9, 27.2];      // 고정 구멍 중심 간격
sma_axis = 8.2;                 // SMA 중심 높이 (기판 바닥 기준)
sma_barrel = 6.4;  sma_hole_extra = 1.0;   // 몸통 지름, 구멍 여유
sma_out = 8.0;                  // SMA 가 기판 밖으로 나온 길이
sma_ys = [W - 8.25, 8.25];      // [J1(주안테나, 위쪽), J3(아래쪽)] y 위치
usb_y = 16.0;  usb_open = [13.2, 7.0];  usb_h = 3.25;   // USB-C 중심 y, 구멍(폭, 높이), 커넥터 높이
uart_x = [17.0, 28.0];  uart_pad = 1.2;  uart_h = 7.5;  // 아래쪽(y=0) 6핀 헤더 슬롯

// ===== 케이스 =====
post_d = 4.4;  pilot_d = 1.7;                            // 받침 지름, 나사 밑구멍
tube_od = 5.0;  tube_od_right = 3.8;  tube_id = 2.3;    // 뚜껑 기둥(왼쪽 굵게, 오른쪽은 SMA 때문에 가늘게), 나사 구멍
head_d = 4.4;  head_depth = 1.0;                         // 나사 머리 자리
gap_usb = 0.4;  gap_sma = 0.3;  gap_y = 0.5;             // 기판과 벽 사이 간극
wall = 2.0;  wall_sma = 1.6;                             // 벽 두께 (SMA 쪽은 얇게)
top_clear = 1.5;                                         // 최고 부품 위 여유
r_out = 3.0;  r_in = 1.0;                                // 바깥/안쪽 모서리 반지름
floor_pad = 2.4;  pocket = [40, 25];  pocket_d = 1.0;   // 평면형: 바닥 두께, 벨크로 자리(가로, 세로, 깊이)
floor_strap = 6.6;                                       // 스트랩형: 바닥 두께
tunnel = [[1.5, 3.2, 11.0], [3.2, 3.9, 9.0], [3.9, 4.6, 7.0]];   // 스트랩 터널 [시작z, 끝z, 반폭] (폭 22 = 반폭 11)
plate = 2.0;  lip_h = 1.0;  lip_t = 1.2;  lip_clear = 0.25;       // 뚜껑 판 두께, 턱 높이·두께·여유
text_depth = 0.6;  text_size = 6;                                  // 뚜껑 글자 깊이·크기

// ===== 파생 값 (건드리지 않아도 됨) =====
function z0(k) = (k == "strap") ? floor_strap : floor_pad;
function pcb_b(k) = z0(k) + hs;
function pcb_top(k) = pcb_b(k) + pcb_t;
function hi(k) = pcb_b(k) + hmax;
function zc(k) = hi(k) + top_clear;
ix0 = -gap_usb;  ix1 = L + gap_sma;  iy0 = -gap_y;  iy1 = W + gap_y;
ox0 = ix0 - wall;  ox1 = ix1 + wall_sma;  oy0 = iy0 - wall;  oy1 = iy1 + wall;
holes = [for (sx = [-1, 1]) for (sy = [-1, 1]) [L / 2 + sx * hole_pitch[0] / 2, W / 2 + sy * hole_pitch[1] / 2]];

// ===== 도구 =====
module box(x0, x1, y0, y1, za, zb) { translate([x0, y0, za]) cube([x1 - x0, y1 - y0, zb - za]); }
module rprism(x0, x1, y0, y1, za, zb, r) {
    translate([x0 + r, y0 + r, za]) linear_extrude(height = zb - za) offset(r = r) square([x1 - x0 - 2 * r, y1 - y0 - 2 * r]);
}
module cylz(cx, cy, r, za, zb) { translate([cx, cy, za]) cylinder(h = zb - za, r = r); }
module cylx(y, z, r, xa, xb) { translate([xa, y, z]) rotate([0, 90, 0]) cylinder(h = xb - xa, r = r); }

// ===== 본체 =====
module base(k) {
    z_0 = z0(k);  z_c = zc(k);  pt = pcb_top(k);
    pilot_bottom = (k == "pad") ? pocket_d : tunnel[len(tunnel) - 1][1];
    difference() {
        union() {
            difference() {
                rprism(ox0, ox1, oy0, oy1, 0, z_c, r_out);                    // 바깥 상자
                rprism(ix0, ix1, iy0, iy1, z_0, z_c + 1, r_in);               // 안쪽 공간
            }
            for (h = holes) cylz(h[0], h[1], post_d / 2, z_0 - 0.01, z_0 + hs);   // 기판 받침
        }
        for (h = holes) cylz(h[0], h[1], pilot_d / 2, pilot_bottom, z_0 + hs + 0.01);   // 나사 밑구멍
        // USB-C 구멍 (왼쪽 벽)
        box(ox0 - 1, ix0 + 0.5, usb_y - usb_open[0] / 2, usb_y + usb_open[0] / 2, pt + usb_h / 2 - usb_open[1] / 2, pt + usb_h / 2 + usb_open[1] / 2);
        // SMA 구멍 2개 (오른쪽 벽)
        for (y = sma_ys) cylx(y, pcb_b(k) + sma_axis, (sma_barrel + sma_hole_extra) / 2, ix1 - 0.5, ox1 + 1);
        // 헤더 케이블 슬롯 (아래 y=0 쪽 벽)
        box(uart_x[0] - uart_pad, uart_x[1] + uart_pad, oy0 - 1, iy0 + 0.5, pt - 0.3, pt + uart_h);
        // 바닥 고정부
        if (k == "pad") box(L / 2 - pocket[0] / 2, L / 2 + pocket[0] / 2, W / 2 - pocket[1] / 2, W / 2 + pocket[1] / 2, -1, pocket_d);
        else for (t = tunnel) box(L / 2 - t[2], L / 2 + t[2], oy0 - 1, oy1 + 1, t[0], t[1]);
    }
}

// ===== 뚜껑 (조립 자세) =====
module lid_asm(k) {
    z_c = zc(k);  top = z_c + plate;  pt = pcb_top(k);
    lx0 = ix0 + lip_clear;  lx1 = ix1 - lip_clear;  ly0 = iy0 + lip_clear;  ly1 = iy1 - lip_clear;
    difference() {
        union() {
            rprism(ox0, ox1, oy0, oy1, z_c, top, r_out);                                  // 판
            difference() {                                                                // 안쪽 턱(본체 안에 끼움)
                rprism(lx0, lx1, ly0, ly1, z_c - lip_h, z_c + 0.01, max(r_in - 0.2, 0.1));
                rprism(lx0 + lip_t, lx1 - lip_t, ly0 + lip_t, ly1 - lip_t, z_c - lip_h - 1, z_c + 1, 0.5);
            }
            for (h = holes) cylz(h[0], h[1], ((h[0] < L / 2) ? tube_od : tube_od_right) / 2, pt, z_c + 0.01);   // 기둥
        }
        for (h = holes) cylz(h[0], h[1], tube_id / 2, pt - 1, top + 1);                        // 나사 구멍
        for (h = holes) cylz(h[0], h[1], head_d / 2, top - head_depth, top + 1);               // 나사 머리 자리
        // 오목 글자: J1=M (위쪽 SMA 쪽), J3=S (아래쪽)
        translate([22.5, 19.0, top - text_depth]) linear_extrude(height = text_depth + 1) text("J1=M", size = text_size, halign = "left", valign = "baseline");
        translate([22.5, 4.5, top - text_depth]) linear_extrude(height = text_depth + 1) text("J3=S", size = text_size, halign = "left", valign = "baseline");
    }
}

// ===== 출력 자세 뚜껑 (바깥면이 베드) =====
module lid_print(k) { translate([0, 0, zc(k) + plate]) rotate([180, 0, 0]) lid_asm(k); }

// ===== 선택 =====
if (part == "pad_base") base("pad");
else if (part == "strap_base") base("strap");
else if (part == "lid") lid_print(kind_for_lid);
else if (part == "lid_asm") lid_asm(kind_for_lid);
else if (part == "assembly") { base(kind_for_lid); translate([0, 0, 18]) lid_asm(kind_for_lid); }
