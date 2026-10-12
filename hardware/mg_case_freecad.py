# -*- coding: utf-8 -*-
"""굴착기 MG용 UM982 수신기 케이스 초안 — 운전실 창틀 철재에 자석으로 붙이고, 24 V 전원, 무선(ESP32 Wi-Fi/BLE 브리지) 운용.
실행: FreeCADCmd mg_case_freecad.py → mg_case.FCStd, mg_case_body.stl, mg_case_lid.stl, mg_case.log

좌표: X = 폭(좌우), Y = 높이(위아래, 창틀에 붙였을 때), Z = 깊이(뒤판 z=0 → 앞 뚜껑). 원점 = 뒤판 중심.
구성(앞에서 봤을 때)
  · 아래쪽 왼쪽: UM982 보드(받침 4개 + M3). SMA 가장자리가 오른쪽을 향하고 오른쪽 벽에 SMA 패널 커넥터 2개(위 = 주안테나 J1, 막대 1개 표시).
  · 위쪽 왼쪽: ESP32 DevKit(무선 브리지, 모서리 받침 + 뚜껑 눌림봉).  · 위쪽 오른쪽: 24 V→5 V 벅 모듈 TPS54560(40.6 x 20.3, 5 V 점퍼 패드).
  · 위 벽: 전원선 PG7 글랜드.  · 뒤판: 네오디뮴 자석 포켓 4개(Ø20 x 5).  · 옆: 안전 스트랩용 귀 2개.
측정값(사용자): 고정 구멍 Ø3.5, SMA 위에서 본 폭 8, 기판에서 올라온 높이 11. 보드 50.23 x 31.80, 구멍 간격 44.9 x 27.2, USB-C 중심 16.
※ 벅 변환기는 TPS54560 모듈(40.6 x 20.3, 입력단이 오른쪽·출력단이 왼쪽)로 확정. ESP32 DevKit 크기는 가정값이다(P 의 'ESP32').
"""
import math
import os

import FreeCAD as App
import Part
import MeshPart
import builtins

here = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else os.getcwd()
_log = open(os.path.join(here, 'mg_case.log'), 'w', encoding='utf-8')


def say(*a):
    s = ' '.join(str(x) for x in a)
    _log.write(s + chr(10))
    _log.flush()
    try:
        builtins.print(s)
    except Exception:
        builtins.print(s.encode('ascii', 'replace').decode())


P = dict(
    # 외형
    wall=4.0, back_t=6.0, inner_d=28.0, lid_t=4.0, W_i=116.0, H_i=80.0, R_out=6.0,
    # 자석(네오디뮴 원판 Ø20 x 5) · 코너 기둥(뚜껑 M3 열압입 인서트)
    mag_d=20.4, mag_depth=5.3, mag_x=44.0, mag_y=26.0,
    pil_d=8.0, ins_d=4.2, ins_depth=9.0, scr_d=3.4, cb_d=6.4, cb_depth=2.4,
    gasket_w=2.2, gasket_d=1.4, gasket_off=1.0,
    # UM982 보드 (측정)
    bd_L=50.23, bd_W=31.80, pcb_t=1.6, hole_dx=44.9, hole_dy=27.2, hole_d=3.5, rise=11.0, sma_w=8.0,
    sma_axis=8.2, sma_y1=8.25, sma_y2=31.80 - 8.25, usb_y=16.0, usb_h=3.25, post_d=7.0, pilot_m3=2.6, post_h=8.0,
    um_x0=-30.0, um_y0=-34.0,
    # SMA 패널 커넥터(벽 관통) / 전원 글랜드
    sma_hole=6.5, gland_hole=12.5, gland_x=34.0,
    # ESP32 DevKit V1 (가정: 51.4 x 28.5, 아래 핀 11 mm) / 벅: TPS54560 모듈 40.6 x 20.3 (AliExpress 1005012443050589, 5.5~60 V, 5 A; 입력단 = 오른쪽, 출력단 = 왼쪽)
    esp_L=51.4, esp_W=28.5, esp_t=1.6, esp_top=5.0, esp_pin=11.0, esp_x0=-48.0, esp_y0=5.0,
    buck_L=40.6, buck_W=20.3, buck_t=1.6, buck_top=11.0, buck_under=4.0, buck_x0=12.0, buck_y0=8.0,
    ledge=4.0, loc_t=1.5, peg_d=5.0,
    # 안전 스트랩 귀
    ear_w=10.0, ear_l=16.0, ear_h=8.0, ear_hole=5.5,
)
v = P
W_o, H_o = v['W_i'] + 2 * v['wall'], v['H_i'] + 2 * v['wall']
ZB = v['back_t'] + v['inner_d']                 # 몸체 윗끝(뚜껑이 닿는 면)
ZT = ZB + v['lid_t']                            # 전체 깊이
R_in = v['R_out'] - v['wall']
pb = v['back_t'] + v['post_h']                  # UM982 기판 바닥 높이
pt = pb + v['pcb_t']


def vec(x, y, z):
    return App.Vector(x, y, z)


def box(x0, x1, y0, y1, z0, z1):
    return Part.makeBox(x1 - x0, y1 - y0, z1 - z0, vec(x0, y0, z0))


def cylz(r, z0, z1, x=0.0, y=0.0):
    return Part.makeCylinder(r, z1 - z0, vec(x, y, z0), vec(0, 0, 1))


def rrz(w, h, r, z0, z1):
    """폭 w, 높이 h, 모서리 반경 r 인 둥근 사각 기둥(z0~z1), 원점 중심"""
    bx = box(-w / 2, w / 2, -h / 2, h / 2, z0, z1)
    ed = [e for e in bx.Edges if abs(e.Vertexes[0].Point.z - e.Vertexes[1].Point.z) > 1e-6]
    return bx.makeFillet(r, ed)


def fuse_all(lst):
    out = lst[0]
    for s in lst[1:]:
        out = out.fuse(s)
    return out


# 코너 기둥 위치(뚜껑 나사) — 안쪽 모서리에서 4.5 mm 들어온 곳
px_, py_ = v['W_i'] / 2 - 4.5, v['H_i'] / 2 - 4.5
CORNERS = [(sx * px_, sy * py_) for sx in (-1, 1) for sy in (-1, 1)]


def um(bx, by):
    """UM982 보드 좌표(bx 길이, by 폭) → 케이스 좌표 (USB 왼쪽, SMA 오른쪽)"""
    return v['um_x0'] + bx, v['um_y0'] + by


holes = [um(v['bd_L'] / 2 + sx * v['hole_dx'] / 2, v['bd_W'] / 2 + sy * v['hole_dy'] / 2) for sx in (-1, 1) for sy in (-1, 1)]
sma_ys = [um(0, v['sma_y1'])[1], um(0, v['sma_y2'])[1]]                      # [아래(ANT2), 위(ANT1 = J1 주안테나)]
sma_z = pb + v['sma_axis']

# ───────────────────────── 몸체 ─────────────────────────
outer = rrz(W_o, H_o, v['R_out'], 0.0, ZB)
cav = rrz(v['W_i'], v['H_i'], R_in, v['back_t'], ZB + 1.0)
body = outer.cut(cav)

adds = []
for cx, cy in CORNERS:                                                            # 뚜껑 나사 기둥
    adds.append(cylz(v['pil_d'] / 2, v['back_t'] - 0.01, ZB, cx, cy))
for hx, hy in holes:                                                              # UM982 받침
    adds.append(cylz(v['post_d'] / 2, v['back_t'] - 0.01, pb, hx, hy))


def corner_supports(x0, y0, L, Wd, z_bottom, t_pcb):
    """기판 네 모서리 아래 받침(ledge)과 가장자리 위치잡이 벽. 기판 윗면은 뚜껑 눌림봉이 누른다."""
    out = []
    lg, lt = v['ledge'], v['loc_t']
    for ix, sx in ((0, 1), (1, -1)):
        for iy, sy in ((0, 1), (1, -1)):
            cx, cy = (x0 if ix == 0 else x0 + L), (y0 if iy == 0 else y0 + Wd)
            ax0, ax1 = sorted((cx, cx + sx * lg))
            ay0, ay1 = sorted((cy, cy + sy * lg))
            out.append(box(ax0, ax1, ay0, ay1, v['back_t'] - 0.01, z_bottom))                       # 받침
            wz1 = z_bottom + t_pcb + 1.2
            bx0, bx1 = sorted((cx - sx * lt - sx * 0.3, cx - sx * 0.3))                              # 가장자리 바깥 벽(여유 0.3)
            out.append(box(bx0, bx1, ay0, ay1, v['back_t'] - 0.01, wz1))
            by0, by1 = sorted((cy - sy * lt - sy * 0.3, cy - sy * 0.3))
            out.append(box(ax0, ax1, by0, by1, v['back_t'] - 0.01, wz1))
    return out


esp_zb = v['back_t'] + v['esp_pin']
buck_zb = v['back_t'] + v['buck_under']
adds += corner_supports(v['esp_x0'], v['esp_y0'], v['esp_L'], v['esp_W'], esp_zb, v['esp_t'])
adds += corner_supports(v['buck_x0'], v['buck_y0'], v['buck_L'], v['buck_W'], buck_zb, v['buck_t'])
for sx in (-1, 1):                                                                # 안전 스트랩 귀(좌우 벽 가운데, 뒤쪽)
    x0 = sx * W_o / 2
    xa, xb = sorted((x0 - sx * 1.0, x0 + sx * v['ear_w']))
    adds.append(box(xa, xb, -v['ear_l'] / 2, v['ear_l'] / 2, 0.0, v['ear_h'] + 4.0))
body = body.fuse(fuse_all(adds))

cuts = []
for cx, cy in CORNERS:                                                            # 열압입 인서트 구멍
    cuts.append(cylz(v['ins_d'] / 2, ZB - v['ins_depth'], ZB + 1.0, cx, cy))
for hx, hy in holes:                                                              # UM982 M3 밑구멍(셀프탭)
    cuts.append(cylz(v['pilot_m3'] / 2, v['back_t'] + 1.0, pb + 1.0, hx, hy))
for sx in (-1, 1):
    for sy in (-1, 1):                                                            # 자석 포켓(뒤에서)
        cuts.append(cylz(v['mag_d'] / 2, -1.0, v['mag_depth'], sx * v['mag_x'], sy * v['mag_y']))
for yy in sma_ys:                                                                 # SMA 패널 커넥터 구멍(오른쪽 벽)
    cuts.append(Part.makeCylinder(v['sma_hole'] / 2, v['wall'] + 2.0, vec(v['W_i'] / 2 - 1.0, yy, sma_z), vec(1, 0, 0)))
cuts.append(Part.makeCylinder(v['gland_hole'] / 2, v['wall'] + 2.0, vec(v['gland_x'], v['H_i'] / 2 - 1.0, (v['back_t'] + ZB) / 2), vec(0, 1, 0)))   # 전원 글랜드(위 벽)
cuts.append(Part.makeCylinder(v['ear_hole'] / 2, v['ear_l'] + 2.0, vec(W_o / 2 + 5.5, -v['ear_l'] / 2 - 1.0, v['ear_h'] / 2 + 2.0), vec(0, 1, 0)))   # 귀 구멍(오른쪽)
cuts.append(Part.makeCylinder(v['ear_hole'] / 2, v['ear_l'] + 2.0, vec(-W_o / 2 - 5.5, -v['ear_l'] / 2 - 1.0, v['ear_h'] / 2 + 2.0), vec(0, 1, 0)))
# 안테나 표시(오른쪽 바깥면 홈): 위 = ANT1(주안테나 J1) 막대 1개, 아래 = ANT2 막대 2개
mk_x = W_o / 2 - 0.6
cuts.append(box(mk_x, W_o / 2 + 1.0, sma_ys[1] + 6.0, sma_ys[1] + 7.2, sma_z - 4.0, sma_z + 4.0))
for dyy in (6.0, 8.4):
    cuts.append(box(mk_x, W_o / 2 + 1.0, sma_ys[0] - dyy - 1.2, sma_ys[0] - dyy, sma_z - 4.0, sma_z + 4.0))
g_out = rrz(W_o - 2 * v['gasket_off'], H_o - 2 * v['gasket_off'], max(v['R_out'] - v['gasket_off'], 1.0), ZB - v['gasket_d'], ZB + 1.0)   # 가스켓(2 mm 실리콘 끈) 홈
g_in = rrz(W_o - 2 * (v['gasket_off'] + v['gasket_w']), H_o - 2 * (v['gasket_off'] + v['gasket_w']), max(v['R_out'] - v['gasket_off'] - v['gasket_w'], 1.0), ZB - v['gasket_d'] - 1.0, ZB + 2.0)
cuts.append(g_out.cut(g_in))
body = body.cut(fuse_all(cuts))

# ───────────────────────── 뚜껑 ─────────────────────────
lid = rrz(W_o, H_o, v['R_out'], ZB, ZT)
lip = rrz(v['W_i'] - 0.6, v['H_i'] - 0.6, R_in - 0.3, ZB - 2.0, ZB + 0.01)
for cx, cy in CORNERS:
    lip = lip.cut(cylz(v['pil_d'] / 2 + 0.4, ZB - 3.0, ZB + 1.0, cx, cy))             # 코너 기둥 자리 비움
lid = lid.fuse(lip)
for cx, cy in CORNERS:
    lid = lid.cut(cylz(v['scr_d'] / 2, ZB - 3.0, ZT + 1.0, cx, cy))
    lid = lid.cut(cylz(v['cb_d'] / 2, ZT - v['cb_depth'], ZT + 1.0, cx, cy))
pegs = []
for (x0, y0, L, Wd, zb_, t_) in ((v['esp_x0'], v['esp_y0'], v['esp_L'], v['esp_W'], esp_zb, v['esp_t']),
                                 (v['buck_x0'], v['buck_y0'], v['buck_L'], v['buck_W'], buck_zb, v['buck_t'])):
    ztop = zb_ + t_ + 0.3
    for cx, cy in ((x0 + 3.5, y0 + 3.5), (x0 + L - 3.5, y0 + 3.5), (x0 + 3.5, y0 + Wd - 3.5), (x0 + L - 3.5, y0 + Wd - 3.5)):
        pegs.append(cylz(v['peg_d'] / 2, ztop, ZB + 0.01, cx, cy))                  # 기판 모서리를 누르는 봉
lid = lid.fuse(fuse_all(pegs))


# ───────────────────────── 검사 ─────────────────────────
def keepout():
    k = []
    k.append(box(um(0, 0)[0], um(v['bd_L'], 0)[0], um(0, 0)[1], um(0, v['bd_W'])[1], pb, pt))                    # UM982 기판
    top = pt + v['rise']                                                                                         # 기판 윗면에서 11 mm (보수적으로 해석)
    k.append(box(um(20.2, 0)[0], um(42.0, 0)[0], um(0, 8.7)[1], um(0, 24.6)[1], pt, pt + 3.5))                  # 칩
    for ys in (v['sma_y1'], v['sma_y2']):
        yy = um(0, ys)[1]
        k.append(box(um(v['bd_L'] - 5.8, 0)[0], um(v['bd_L'], 0)[0], yy - v['sma_w'] / 2, yy + v['sma_w'] / 2, pt, top))   # SMA 몸체(폭 8)
        k.append(Part.makeCylinder(3.2, 14.0, vec(um(v['bd_L'] - 6, 0)[0], yy, pb + v['sma_axis']), vec(1, 0, 0)))        # SMA 몸통(밖으로 8)
        k.append(Part.makeCylinder(4.6, 7.0, vec(um(v['bd_L'] + 8, 0)[0], yy, pb + v['sma_axis']), vec(1, 0, 0)))         # 연결 플러그
    xu, yu = um(0, v['usb_y'])
    k.append(box(xu - 0.9, xu + 0.5, yu - 4.5, yu + 4.5, pt, pt + v['usb_h']))
    ex, ey = v['esp_x0'], v['esp_y0']
    k.append(box(ex, ex + v['esp_L'], ey, ey + v['esp_W'], esp_zb, esp_zb + v['esp_t']))                                                         # ESP32 기판
    k.append(box(ex + 6.0, ex + v['esp_L'] - 6.0, ey + 5.0, ey + v['esp_W'] - 5.0, esp_zb + v['esp_t'], esp_zb + v['esp_t'] + v['esp_top']))       # 모듈·부품(모서리는 비움)
    k.append(box(ex - 0.5, ex + 6.0, ey + v['esp_W'] / 2 - 4.5, ey + v['esp_W'] / 2 + 4.5, esp_zb + v['esp_t'], esp_zb + v['esp_t'] + 3.0))      # USB 커넥터
    bx_, by_ = v['buck_x0'], v['buck_y0']
    k.append(box(bx_, bx_ + v['buck_L'], by_, by_ + v['buck_W'], buck_zb, buck_zb + v['buck_t']))                                               # 벅 기판
    k.append(box(bx_ + 6.0, bx_ + v['buck_L'] - 6.0, by_ + 5.0, by_ + v['buck_W'] - 5.0, buck_zb + v['buck_t'], buck_zb + v['buck_t'] + v['buck_top']))   # 부품(모서리는 비움)
    return fuse_all(k)


KO = keepout()
for nm, s in (('몸체', body), ('뚜껑', lid)):
    say('%s: 솔리드 %d개, 유효 %s, 부피 %.0f mm³' % (nm, len(s.Solids), s.isValid(), s.Volume))
say('겹침(0이어야 함): 몸체∩부품영역 %.3f, 뚜껑∩부품영역 %.3f, 몸체∩뚜껑 %.3f mm³' % (body.common(KO).Volume, lid.common(KO).Volume, body.common(lid).Volume))
say('외형 %.0f x %.0f x %.0f mm (폭 x 높이 x 깊이), 안쪽 %.0f x %.0f x %.0f' % (W_o, H_o, ZT, v['W_i'], v['H_i'], v['inner_d']))
say('SMA 구멍 Y: 아래(ANT2) %.2f / 위(ANT1=J1) %.2f, 높이 z %.1f, 간격 %.2f' % (sma_ys[0], sma_ys[1], sma_z, sma_ys[1] - sma_ys[0]))
say('UM982 구멍 위치:', [(round(a, 2), round(b, 2)) for a, b in holes])
say('자석: Ø%.0f x 5 네오디뮴 4개 (간격 %.0f x %.0f)' % (v['mag_d'] - 0.4, 2 * v['mag_x'], 2 * v['mag_y']))

doc = App.newDocument('mg_case')
for nm, shp in (('Body', body), ('Lid', lid), ('Ref_Parts', KO)):
    o = doc.addObject('Part::Feature', nm)
    o.Shape = shp
doc.recompute()
out = os.path.join(here, 'mg_case.FCStd')
doc.saveAs(out)
say('저장:', out)


def save_stl(shape, path, name):
    m = MeshPart.meshFromShape(Shape=shape, LinearDeflection=0.05, AngularDeflection=0.2)
    m.write(path)
    say('STL', name, m.CountFacets, '면 →', path)


lid_flat = lid.copy()
lid_flat.rotate(vec(0, 0, 0), vec(1, 0, 0), 180)
lid_flat.translate(vec(0, 0, ZT))
save_stl(body, os.path.join(here, 'mg_case_body.stl'), '몸체(뒤판이 베드)')
save_stl(lid_flat, os.path.join(here, 'mg_case_lid.stl'), '뚜껑(바깥면이 베드)')
