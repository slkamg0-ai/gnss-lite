# -*- coding: utf-8 -*-
"""버전 2 사각 몸체 초안 — WitMotion WTRTK-980(UM980) 보드를 세워 넣는 슬림 방수 타워. 아래 몸체는 둥근 사각 단면, 위 목(바요넷·O링)은 Ø38 원통 (FreeCAD 모델 생성 스크립트).
※ 부품이 아직 정해지지 않았고 보드가 도착하기 전이므로 보드·단자 치수는 모두 '가정값'이다(맨 위 PARAMS 의 "가정" 항목).

실행: FreeCADCmd um982_v2r_freecad.py  → um982_v2r.FCStd, um982_v2r_body.stl, um982_v2r_head.stl, um982_v2r_freecad.log
구조(조립 상태, 원점 = 베이스판 윗면 중심, z 위)
  본체: 지름 38 원통(안테나 몸통 Ø38 과 같은 굵기). 바닥 중앙 5/8"-11 수나사 7 mm(베이스판 중앙 구멍).
        보드는 위에서 내려 끼운다: 모서리 4곳 짧은 슬롯 받침(홈 폭 = 기판 1.6 + 여유)에 물리고 나사는 없다.
        옆(+y)에 평평한 패드 + 둥근 사각 방수 USB-C 단자 구멍(패킹 홈 포함, 머리 치마 아래), 목 위쪽에 바요넷 걸림쇠 3개 + O링 홈(반경 방향).
  머리: 지름 50 (안테나 귀 반지름 24.9 를 덮음). 윗판에 안테나 M3 x 4(볼트 원 Ø40, 열압입 인서트 구멍), 가운데 목 구멍 Ø22,
        안테나 밑 면 O링 홈. 아래 치마가 본체 목을 덮고 1/4바퀴(35°)로 잠긴다. 안쪽 빈 공간은 안테나 케이블(60 cm) 보관.
고정 형상(슬롯 받침·걸림쇠·바요넷 홈)은 스크립트가 숫자로 만든다 → 이 값들은 Params 를 바꿔도 따라 바뀌지 않으니 스크립트 PARAMS 를 고쳐 다시 실행한다.
"""
import math
import os
import re

import FreeCAD as App
import Part
import MeshPart
import builtins

here = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else os.getcwd()
_log = open(os.path.join(here, 'um982_v2r_freecad.log'), 'w', encoding='utf-8')


def say(*a):
    s = ' '.join(str(x) for x in a)
    _log.write(s + chr(10))
    _log.flush()
    try:
        builtins.print(s)
    except Exception:
        builtins.print(s.encode('ascii', 'replace').decode())


PARAMS = [
    ('# 외형', None, None),
    ('body_w', 34.0, '아래 몸체 사각 폭(x)'), ('body_d', 16.6, '아래 몸체 사각 두께(y)'), ('body_r', 5.0, '사각 모서리 반경'), ('rwall', 2.4, '사각 몸체 벽 두께'), ('pat_n', 12, '옆면 문양 반복 수(30° 간격)'), ('pat_depth', 0.7, '문양 음각 깊이'), ('pat_w', 1.2, '문양 선 폭'), ('pat_z0', 58.5, '문양 시작 높이(z)'),
    ('head_chamfer_bot', 1.5, '머리 치마 아래 바깥 모서리 직선 모깎기(45°) 변 길이'), ('head_chamfer_top', 2.0, '머리 윗면 바깥 모서리 직선 모깎기(45°) 변 길이'),
    ('logo_size', 20.0, '로고 한 변(mm) — princedotcom_markB_20mm.svg'), ('logo_depth', 0.6, '로고 음각 깊이'), ('logo_zc', 26.0, '로고 중심 높이(z)'), ('sh_t', 3.0, '사각→원통 전환 판 두께(원통 안쪽 공간이 사각 몸체 밖으로 뚫리는 곳을 막음)'),
    ('D_body', 38.0, '몸체 바깥 지름(안테나 Ø38 과 같게)'), ('wall', 3.0, '몸체 벽 두께'),
    ('D_head', 50.0, '머리 바깥 지름'), ('floor_t', 3.0, '바닥 두께'),
    ('# 가정: 보드 WTRTK-980 (실측 필요)', None, None),
    ('bd_W', 26.0, '보드 폭'), ('bd_H', 38.0, '보드 높이(세운 길이)'), ('bd_T', 7.6, '보드 전체 두께(부품 포함)'), ('pcb_t', 1.6, '기판 두께'),
    ('slot_clr', 0.3, '슬롯 홈 여유'), ('rail_len', 8.0, '슬롯 받침 길이'), ('rail_depth', 2.0, '기판 가장자리 물리는 깊이'), ('rail_thk', 5.0, '받침 두께(앞뒤)'),
    ('stop_h', 2.0, '보드 아래 받침턱 높이'), ('plug_zone', 22.0, '보드 위 USB 플러그 공간 높이'),
    ('usb_w', 14.0, '단자 구멍 폭(가정: 사각 플랜지형 방수 USB-C)'), ('usb_h', 8.0, '단자 구멍 높이'), ('usb_r', 2.5, '구멍 모서리 반경'),
    ('usb_panel_dz', 1.5, '구멍 중심 높이(보드 위끝 위) — 머리 치마(z_s) 아래에 들어와야 함'),
    ('gk_w', 1.6, '패킹 홈 폭'), ('gk_d', 1.0, '패킹 홈 깊이'), ('gk_gap', 1.2, '구멍 가장자리에서 패킹 홈 안쪽까지 거리'),
    ('# 안테나 BT-T009', None, None),
    ('ant_cable_len', 600.0, '안테나 케이블 길이(짧게 자르면 머리 높이가 줄어듦)'), ('neck_hole_d', 22.0, '안테나 목 구멍'),
    ('ant_neck_len', 13.0, '목이 바닥 아래로 나온 길이(가정)'), ('ear', 40 / math.sqrt(2) / 2, 'M3 구멍 위치(±)'),
    ('ant_insert_d', 4.2, '열압입 M3 인서트 구멍'), ('ant_insert_depth', 6.0, '인서트 구멍 깊이'), ('plate_t', 10.0, '윗판 두께'),
    ('coil_r', 14.5, '케이블 감는 반지름'), ('cable_d_stack', 2.6, '케이블 한 줄 높이'),
    ('# 바요넷 / O링', None, None),
    ('h_overlap', 12.0, '머리 치마가 본체 목을 덮는 높이'), ('bore_clr', 0.25, '치마 안쪽 여유'),
    ('lug_h', 3.0, '걸림쇠 높이'), ('lug_w', 4.0, '걸림쇠 폭'), ('lug_r', 2.0, '걸림쇠 돌출'), ('lug_zoff', 10.0, '걸림쇠 아래면의 목 위끝 아래 거리(O링 홈보다 아래)'),
    ('track_clr', 0.3, '홈 여유'), ('bay_angle', 35.0, '잠금 각도(도)'),
    ('oring_cs', 2.0, 'O링 단면 지름'), ('groove_w', 2.6, 'O링 홈 폭'), ('groove_d', 1.5, 'O링 홈 깊이'), ('face_r_in', 14.0, '안테나 밑면 O링 홈 안쪽 반지름'),
    ('# 바닥 5/8"-11 나사', None, None),
    ('stud_len', 4.5, '수나사 길이(판 20 mm - 폴 스터드 15 mm - 여유 0.5)'), ('stud_major', 25.4 * 5 / 8, '나사 바깥 지름'), ('stud_pitch', 25.4 / 11, '피치'), ('stud_clear', 0.35, '프린트 공차'),
    ('# 파생값', None, None),
    ('R_body', '=D_body / 2', ''), ('R_in', '=R_body - wall', ''), ('R_head', '=D_head / 2', ''),
    ('z_b', '=floor_t + stop_h', '보드 아래끝'), ('z_t', '=z_b + bd_H', '보드 위끝'), ('z_bt', '=z_t + plug_zone', '본체 위끝'),
    ('z_s', '=z_bt - h_overlap', '머리 치마 아래끝'), ('z_c', '=z_s - 1', '사각 몸체 → 원통 목 전환 높이'),
    ('coil_h', '=ceil((ant_cable_len - 120) / (2 * pi * coil_r)) * cable_d_stack + 4', '케이블 보관 공간 높이'),
    ('z_pl', '=z_bt + coil_h', '윗판 아랫면'), ('z_top', '=z_pl + plate_t', '안테나 바닥(윗면)'),
    ('R_bore', '=R_body + bore_clr', ''), ('z_l', '=z_bt - lug_zoff', '걸림쇠 아랫면 높이'),
]

doc = App.newDocument('um982_v2r')
sheet = doc.addObject('Spreadsheet::Sheet', 'Params')
row = 1
for name, val, note in PARAMS:
    sheet.set('A%d' % row, name)
    if val is not None:
        sheet.set('B%d' % row, val if isinstance(val, str) else repr(float(val)))
        sheet.setAlias('B%d' % row, name)
        sheet.set('C%d' % row, note)
    row += 1
doc.recompute()
V = {n: float(sheet.get(n)) for n, val, _ in PARAMS if val is not None}
NAMES = sorted(V, key=len, reverse=True)
v = V


def X(expr):
    return re.sub(r'\b(%s)\b' % '|'.join(NAMES), r'Params.\1', expr)


def vec(x, y, z):
    return App.Vector(x, y, z)


def cyl(name, r, h, x=0.0, y=0.0, z=0.0):
    o = doc.addObject('Part::Cylinder', name)
    o.Placement = App.Placement(vec(x, y, 0.0 if isinstance(z, str) else z), App.Rotation())
    for prop, val in (('Radius', r), ('Height', h)):
        if isinstance(val, str):
            o.setExpression(prop, X(val))
        else:
            setattr(o, prop, val)
    if isinstance(z, str):
        o.setExpression('Placement.Base.z', X(z))
    return o


def feat(name, shape):
    o = doc.addObject('Part::Feature', name)
    o.Shape = shape
    return o


def fuse(name, objs):
    if len(objs) == 1:
        return objs[0]
    o = doc.addObject('Part::MultiFuse', name)
    o.Shapes = objs
    return o


def cut(name, base, tool):
    o = doc.addObject('Part::Cut', name)
    o.Base, o.Tool = base, tool
    return o


def thread_ridge(name, r_expr, z0_expr, h_expr, pitch_expr, dx_tip, w_base, w_tip):
    helix = doc.addObject('Part::Helix', name + '_helix')
    helix.setExpression('Pitch', X(pitch_expr))
    helix.setExpression('Height', X(h_expr))
    helix.setExpression('Radius', X(r_expr))
    helix.setExpression('Placement.Base.z', X(z0_expr))
    pts = [(0.0, -w_base / 2), (dx_tip, -w_tip / 2), (dx_tip, w_tip / 2), (0.0, w_base / 2), (0.0, -w_base / 2)]
    prof = doc.addObject('Part::Feature', name + '_profile')
    prof.Shape = Part.makePolygon([vec(px, 0, pz) for px, pz in pts])
    prof.setExpression('Placement.Base.x', X(r_expr))
    prof.setExpression('Placement.Base.z', X(z0_expr))
    sw = doc.addObject('Part::Sweep', name)
    sw.Sections = [prof]
    sw.Spine = (helix, [])
    sw.Solid = True
    sw.Frenet = True
    return sw


def rotz(shape, deg):
    s = shape.copy()
    s.rotate(vec(0, 0, 0), vec(0, 0, 1), deg)
    return s


def box(x0, x1, y0, y1, z0, z1):
    return Part.makeBox(x1 - x0, y1 - y0, z1 - z0, vec(x0, y0, z0))


def zcyl(r, z0, z1, ang=360.0):
    return Part.makeCylinder(r, z1 - z0, vec(0, 0, z0), vec(0, 0, 1), ang)


R_body, R_in, R_head, R_bore = v['R_body'], v['R_in'], v['R_head'], v['R_bore']
z_b, z_t, z_bt, z_s, z_pl, z_top, z_l = v['z_b'], v['z_t'], v['z_bt'], v['z_s'], v['z_pl'], v['z_top'], v['z_l']
hw = v['bd_W'] / 2
ANG = [0.0, 120.0, 240.0]

# ───────────────────────── 본체 ─────────────────────────
def rrz(w, d, r, z0, z1):
    """x 폭 w, y 두께 d, 모서리 반경 r 인 둥근 사각 기둥(z0~z1), 원점 중심"""
    bx = box(-w / 2, w / 2, -d / 2, d / 2, z0, z1)
    ed = [e for e in bx.Edges if abs(e.Vertexes[0].Point.z - e.Vertexes[1].Point.z) > 1e-6]
    return bx.makeFillet(r, ed)


z_c = v['z_c']
bw, bd, br, rw = v['body_w'], v['body_d'], v['body_r'], v['rwall']
b_rect = feat('Body_RectOuter', rrz(bw, bd, br, 0.0, z_c + 1.0))
b_collar = cyl('Body_Collar', 'R_body', 'z_bt - z_c', z='z_c')
b_out = fuse('Body_Outer', [b_rect, b_collar])
b_cavr = feat('Body_RectCavity', rrz(bw - 2 * rw, bd - 2 * rw, br - rw, v['floor_t'], z_c + v['sh_t'] + 1.0))
b_cavc = cyl('Body_CollarCavity', 'R_in', 'z_bt + 1 - z_c - sh_t', z='z_c + sh_t')
b_cav = fuse('Body_Cavity', [b_cavr, b_cavc])
b_shell = cut('Body_Shell', b_out, b_cav)
assert math.hypot(bw / 2 - br, bd / 2 - br) + br < R_body, '사각 몸체가 원통 목 밖으로 나옴'

# 슬롯 받침(모서리 4곳): 기판 가장자리(±hw)를 rail_depth 만큼 물고, 아래 받침턱이 보드를 받친다. 위는 열려 있어 위에서 끼운다.
rails = None
slits = None
for sx in (-1, 1):
    for (za, zb_) in ((z_b - v['stop_h'], z_b + v['rail_len']), (z_t - v['rail_len'], z_t + 3.0)):
        xa, xb = sorted((sx * (hw - v['rail_depth']), sx * (bw / 2 - rw + 0.5)))
        blk = box(xa, xb, -v['rail_thk'] / 2, v['rail_thk'] / 2, za, zb_)
        rails = blk if rails is None else rails.fuse(blk)
        g0 = z_b if za < z_b else za - 1
        gx0, gx1 = sorted((sx * (hw - v['rail_depth'] - 0.01), sx * (hw + v['slot_clr'])))
        sl = box(gx0, gx1, -(v['pcb_t'] + v['slot_clr']) / 2, (v['pcb_t'] + v['slot_clr']) / 2, g0, zb_ + 1)
        slits = sl if slits is None else slits.fuse(sl)
b_rails = feat('Body_Rails', rails)
b_slits = feat('Body_Slits', slits)

# 걸림쇠 3개(목 위쪽) + 반경 방향 O링 홈
lug0 = box(R_body - 0.3, R_body + v['lug_r'], -v['lug_w'] / 2, v['lug_w'] / 2, z_l, z_l + v['lug_h'])
lugs = lug0
for a in ANG[1:]:
    lugs = lugs.fuse(rotz(lug0, a))
b_lugs = feat('Body_Lugs', lugs)
z_g = z_bt - 3.5 - v['groove_w']
groove = zcyl(R_body + 0.01, z_g, z_g + v['groove_w']).cut(zcyl(R_body - v['groove_d'], z_g - 1, z_g + v['groove_w'] + 1))
b_groove = feat('Body_ORingGroove', groove)

# 방수 USB-C 패널 단자: 아래 몸체의 평평한 +y 면(폭 34 mm)에 둥근 사각 구멍 + 패킹(가스켓) 홈. 면이 평평하므로 별도 패드가 필요 없다. 머리 치마(z_s) 아래.
def rrect(w, h, r, y0, y1, zc):
    """x 폭 w, z 높이 h, 모서리 반경 r 인 둥근 사각 기둥(y0~y1, 중심 높이 zc)"""
    bx = box(-w / 2, w / 2, y0, y1, zc - h / 2, zc + h / 2)
    ed = [e for e in bx.Edges if abs(e.Vertexes[0].Point.y - e.Vertexes[1].Point.y) > 1e-6]
    return bx.makeFillet(r, ed)


z_u = z_t + v['usb_panel_dz']
y_f = bd / 2
assert z_u + (v['usb_h'] + 2 * (v['gk_gap'] + v['gk_w'])) / 2 < z_c, '단자 홈이 원통 목과 겹침'
o_w, o_h = v['usb_w'] + 2 * (v['gk_gap'] + v['gk_w']), v['usb_h'] + 2 * (v['gk_gap'] + v['gk_w'])
i_w, i_h = v['usb_w'] + 2 * v['gk_gap'], v['usb_h'] + 2 * v['gk_gap']
ro, ri = v['usb_r'] + v['gk_gap'] + v['gk_w'], v['usb_r'] + v['gk_gap']
gasket = rrect(o_w, o_h, ro, y_f - v['gk_d'], y_f + 1, z_u).cut(rrect(i_w, i_h, ri, y_f - v['gk_d'] - 1, y_f + 2, z_u))
b_gasket = feat('Body_UsbGasketGroove', gasket)
usb = rrect(v['usb_w'], v['usb_h'], v['usb_r'], y_f - rw - 1.0, y_f + 1, z_u)
b_usb = feat('Body_UsbHole', usb)

# 로고(princedotcom_markB, viewBox 8 8 104 104 → 20 mm): 평평한 -y 면(USB 반대쪽 정면)에 음각. 정면(-y)에서 바라보면 바르게 읽힌다.
# 외곽 프레임(두 윤곽, 짝-홀 규칙) · P 글자(바깥+안쪽 구멍) · 점. 좌표는 SVG 단위(위가 작은 y)
LOGO = {'frame': [[(8, 8), (92, 8), (112, 28), (112, 112), (28, 112), (8, 92)], [(16, 16), (88.686, 16), (104, 31.314), (104, 104), (31.314, 104), (16, 88.686)]],
        'letter': [[(37, 30), (73, 30), (83, 40), (83, 58), (73, 68), (53, 68), (53, 90), (37, 90)], [(53, 44), (69, 44), (69, 54), (53, 54)]],
        'dot': [[(69, 76), (83, 76), (83, 90), (69, 90)]]}


def logo_solid(y_face, depth, zc, size):
    sc = size / 104.0
    y0 = y_face - 1.0                                   # 면 바깥 1 mm 에서 시작해 면 + depth 까지 파낸다
    out = None
    for rings in LOGO.values():
        faces = []
        for ring in rings:
            pts = [vec((x - 60) * sc, y0, zc + (60 - y) * sc) for x, y in ring]
            faces.append(Part.Face(Part.makePolygon(pts + [pts[0]])))
        f = faces[0]
        for hole in faces[1:]:
            f = f.cut(hole)
        sol = f.extrude(vec(0, 1.0 + depth, 0))
        out = sol if out is None else out.fuse(sol)
    return out


b_logo = feat('Body_LogoEngrave', logo_solid(-bd / 2, v['logo_depth'], v['logo_zc'], v['logo_size']))
_lb = b_logo.Shape.BoundBox
assert abs(_lb.XMax) <= bw / 2 - br and _lb.ZMin > v['floor_t'] and _lb.ZMax < z_c - 1, '로고가 평평한 면 밖으로 나감'

b1 = fuse('Body_WithRails', [b_shell, b_rails, b_lugs])
b2 = cut('Body_Slotted', b1, b_slits)
b3 = cut('Body_Grooved', b2, b_groove)
b3b = cut('Body_UsbGasket', b3, b_gasket)
b4 = cut('Body_UsbHole', b3b, b_usb)
b5 = cut('Body_Logo', b4, b_logo)
st_core = cyl('Stud_Core', '(stud_major - stud_clear) / 2 - 1.35', 'stud_len + 0.5', z='-stud_len')
st_thr = thread_ridge('Stud_Thread', '(stud_major - stud_clear) / 2 - 1.35 - 0.1', '-stud_len + 1.0', 'stud_len - 1.0', 'stud_pitch', 1.35 + 0.1, 2.0, 0.25)
body = fuse('Body', [b5, st_core, st_thr])

# ───────────────────────── 머리 ─────────────────────────
h_out = cyl('Head_Outer', 'R_head', 'z_top - z_s', z='z_s')
h_bore = cyl('Head_Bore', 'R_bore', 'z_pl - z_s + 0.01', z='z_s - 0.01')
h_shell = cut('Head_Shell', h_out, h_bore)

# 바요넷 홈: 치마 안쪽 벽에 파는 L자 길(세로 진입 + 가로 35°). 막힌 홈이라 방수에 영향 없음
tr_h = v['lug_h'] + 2 * v['track_clr']
tr_z0 = z_l - v['track_clr']
r_track = R_body + v['lug_r'] + v['track_clr']
extra = math.degrees((v['lug_w'] / 2 + v['track_clr']) / R_bore)
arc0 = Part.makeCylinder(r_track, tr_h, vec(0, 0, tr_z0), vec(0, 0, 1), v['bay_angle'] + extra)
arc0 = arc0.cut(zcyl(R_bore - 0.5, tr_z0 - 1, tr_z0 + tr_h + 1))
ent0 = box(R_bore - 0.5, r_track, -(v['lug_w'] / 2 + v['track_clr']), v['lug_w'] / 2 + v['track_clr'], z_s - 0.01, tr_z0 + tr_h)
trk0 = arc0.fuse(ent0)
trk = trk0
for a in ANG[1:]:
    trk = trk.fuse(rotz(trk0, a))
h_track = feat('Head_Tracks', trk)

# 윗판: 목 구멍 + 안테나 밑면 O링 홈 + 안테나 M3 인서트 구멍 4개
h_neck = cyl('Head_NeckHole', 'neck_hole_d / 2', 'plate_t + 2', z='z_pl - 0.01')
fg_out = v['face_r_in'] + v['groove_w']
face = zcyl(fg_out, z_top - v['groove_d'], z_top + 1).cut(zcyl(v['face_r_in'], z_top - v['groove_d'] - 1, z_top + 2))
h_face = feat('Head_FaceORingGroove', face)
ins = [cyl('Head_Insert%d' % i, 'ant_insert_d / 2', 'ant_insert_depth + 1', x=sx * v['ear'], y=sy * v['ear'], z='z_top - ant_insert_depth')
       for i, (sx, sy) in enumerate([(-1, -1), (-1, 1), (1, -1), (1, 1)])]
h_cuts = fuse('Head_Cuts', [h_neck, h_face, h_track] + ins)
head = cut('Head', h_shell, h_cuts)


# 머리 옆면(곡면) 사이버풍 문양: PCB 회로 배선처럼 수직선 + 45° 꺾임 + 사각 노드. 한 칸(30°)을 평면에 그려 반지름 방향으로 뚫고
# 바깥 껍질(깊이 pat_depth)과 교차시켜 곡면에서도 깊이가 일정하게 한 뒤 둘레로 pat_n 번 복사해 판다.
def pattern_tool():
    n, w, dep, z0, R = int(v['pat_n']), v['pat_w'], v['pat_depth'], v['pat_z0'], R_head
    traces = [[(-4.5, 0), (-4.5, 5), (-2.5, 7), (-2.5, 13), (-4.5, 15), (-4.5, 20)],
              [(4.5, 3), (4.5, 8), (2.5, 10), (2.5, 16), (4.5, 18), (4.5, 23)]]
    pads = [(-4.5, 20), (4.5, 23), (-4.5, 0), (4.5, 3)]          # 배선 양 끝의 사각 노드
    polys = []
    for tr in traces:
        for (x1, y1), (x2, y2) in zip(tr[:-1], tr[1:]):
            L = math.hypot(x2 - x1, y2 - y1)
            ux, uy, h = (x2 - x1) / L, (y2 - y1) / L, w / 2
            a, b = (x1 - ux * h, y1 - uy * h), (x2 + ux * h, y2 + uy * h)           # 사각 끝으로 꺾이는 곳을 메운다
            polys.append([(a[0] - uy * h, a[1] + ux * h), (b[0] - uy * h, b[1] + ux * h), (b[0] + uy * h, b[1] - ux * h), (a[0] + uy * h, a[1] - ux * h)])
    for cx, cy in pads:
        k = 1.3
        polys.append([(cx - k, cy - k), (cx + k, cy - k), (cx + k, cy + k), (cx - k, cy + k)])
    mod = None
    for poly in polys:                                            # 모듈 평면: 접선 방향 = y, 높이 = z, 바깥쪽 = +x
        pts = [vec(R + 2.0, u, z0 + t) for u, t in poly]
        sol = Part.Face(Part.makePolygon(pts + [pts[0]])).extrude(vec(-(2.0 + dep + 1.5), 0, 0))
        mod = sol if mod is None else mod.fuse(sol)
    shell = Part.makeCylinder(R + 3.0, 40.0, vec(0, 0, z0 - 5)).cut(Part.makeCylinder(R - dep, 40.0, vec(0, 0, z0 - 5)))
    mod = mod.common(shell)
    return Part.makeCompound([rotz(mod, i * 360.0 / n) for i in range(n)])


head = cut('Head_Patterned', head, feat('Head_Pattern', pattern_tool()))

doc.recompute()
# 머리의 아래(치마 끝, z=z_s)·윗면(z=z_top) 바깥 모서리(R_head 원)를 곡면이 아닌 직선 모깎기(45° 챔퍼)로 마무리한다.
# 원래 Head 는 두고 Head_Chamfer 가 최종 머리가 된다
head_raw = head


def outer_edge(z):
    r = [i for i, e in enumerate(head_raw.Shape.Edges, 1)
         if e.Curve.TypeId == 'Part::GeomCircle' and abs(e.Curve.Radius - R_head) < 0.01 and abs(e.BoundBox.ZMin - z) < 0.05 and abs(e.BoundBox.ZMax - z) < 0.05]
    assert len(r) == 1, '머리 바깥 모서리(z=%.1f)를 찾지 못함: %s' % (z, r)
    return r[0]


head = doc.addObject('Part::Chamfer', 'Head_Chamfer')
head.Base = head_raw
head.Edges = [(outer_edge(z_s), v['head_chamfer_bot'], v['head_chamfer_bot']), (outer_edge(z_top), v['head_chamfer_top'], v['head_chamfer_top'])]
doc.recompute()
bad = [o.Name for o in doc.Objects if 'Invalid' in o.State or 'Error' in ' '.join(o.State)]
say('재계산 오류 객체:', bad or '없음')


# ───────────────────────── 검사 ─────────────────────────
def keepout():
    parts = [box(-11.0, 11.0, -v['bd_T'] / 2, v['bd_T'] / 2, z_b, z_t),                       # 보드 본체(부품 포함, 가정)
             box(-hw, hw, -v['pcb_t'] / 2, v['pcb_t'] / 2, z_b, z_t),                         # 기판(가장자리 포함)
             box(-5.0, 5.0, -5.0, 5.0, z_t, z_t + v['plug_zone'] - 2.0),                      # 위쪽 Type-C 플러그 자리
             Part.makeCylinder(10.2, v['ant_neck_len'], vec(0, 0, z_top - v['ant_neck_len']))]   # 안테나 목
    k = parts[0]
    for p in parts[1:]:
        k = k.fuse(p)
    return k


KO = keepout()
# 전환 판 검사: 원통 안쪽 반경 안이면서 사각 몸체 밖인 자리(±y 쪽)가 판으로 막혀 있어야 한다(뚫려 있으면 안쪽이 밖과 이어짐)
for sy in (-1, 1):
    assert body.Shape.isInside(vec(0, sy * 12.0, z_c + v['sh_t'] / 2), 0.01, True), '전환 판이 비어 있음(y=%+d)' % sy
say('전환 판 확인: 사각 몸체 밖 ±y 구간이 z %.0f~%.0f 에서 막혀 있음' % (z_c, z_c + v['sh_t']))
for nm, o in (('본체', body), ('머리', head)):
    s = o.Shape
    say('%s: 솔리드 %d개, 유효 %s, 부피 %.0f mm³' % (nm, len(s.Solids), s.isValid(), s.Volume))
say('겹침(0이어야 함): 본체∩부품영역 %.3f, 머리∩부품영역 %.3f, 본체∩머리 %.3f mm³' % (
    body.Shape.common(KO).Volume, head.Shape.common(KO).Volume, body.Shape.common(head.Shape).Volume))
say('높이: 보드 z %.0f~%.0f, 본체 위끝 %.0f, 머리 윗면(안테나 바닥) %.1f mm, 케이블 보관 공간 높이 %.1f mm, 바깥 지름 몸통 %.0f / 머리 %.0f' % (
    z_b, z_t, z_bt, z_top, v['coil_h'], v['D_body'], v['D_head']))
vol_cm3 = ((bw * bd - (4 - math.pi) * br ** 2) * z_c + math.pi * R_body ** 2 * (z_bt - z_c) + math.pi * R_head ** 2 * (z_top - z_bt)) / 1000
say('외형 부피 약 %.0f cm³ (눕힌 마운트 Ø96.5x40 = %.0f cm³)' % (vol_cm3, math.pi * 48.25 ** 2 * 40 / 1000))

ref = feat('Ref_BoardKeepout', KO)
doc.recompute()
FINAL = ('Body', 'Head_Chamfer', 'Ref_BoardKeepout')
for o in doc.Objects:
    if o.Name != 'Params':
        o.Visibility = o.Name in FINAL
out = os.path.join(here, 'um982_v2r.FCStd')
doc.saveAs(out)
say('저장:', out)


def save_stl(shape, path, name):
    m = MeshPart.meshFromShape(Shape=shape, LinearDeflection=0.05, AngularDeflection=0.2)
    m.write(path)
    say('STL', name, m.CountFacets, '면 →', path)


def flip(shape, z_after):
    s = shape.copy()
    s.rotate(vec(0, 0, 0), vec(1, 0, 0), 180)
    s.translate(vec(0, 0, z_after))
    return s


save_stl(flip(body.Shape, z_bt), os.path.join(here, 'um982_v2r_body.stl'), '본체(나사가 위)')
save_stl(flip(head.Shape, z_top), os.path.join(here, 'um982_v2r_head.stl'), '머리(윗판이 베드)')
