# -*- coding: utf-8 -*-
"""UM982 일체형 마운트 (눕힌 보드, 안테나 직결 뚜껑, 병뚜껑식 나사 체결) — FreeCAD 모델 생성 스크립트.

사용(FreeCAD 가 설치된 상태):
  FreeCADCmd um982_mount_freecad.py          → um982_mount.FCStd 와 출력용 STL 2개 생성
  또는 FreeCAD 에서 매크로로 실행해도 된다.
만들어진 um982_mount.FCStd 를 FreeCAD 로 열어 'Params' 스프레드시트의 숫자를 고치면(Ctrl+R 로 다시 계산) 모양이 따라 바뀐다.
  ※ 나사산 단면 모양(60° 사다리꼴 산 폭/높이 비율)은 이 스크립트에 고정돼 있다. 높이·피치·반지름은 스프레드시트에 연결돼 있다.

구조(조립 상태, 원점 = 알루미늄 원판 윗면 중심, z 위)
  본체  : 지름 96.5, 높이 14 까지 원통, 그 위로 외나사 목(14~26). 바닥 중앙에 5/8"-11 수나사 7 mm(원판 중앙 구멍으로).
          보드는 눕혀서 4개 받침에 M3 x 8 로 고정(바닥까지 관통하는 밑구멍). SMA 는 앞(-y), USB-C 는 뒤(+y)로 나온다. 보드는 뒤쪽으로 12 mm 옮겨
          SMA 플러그 앞쪽에 케이블 굽힘 공간을 둔다.
  뚜껑  : 높이 14~40, 안쪽 내나사를 목에 돌려 닫는다(병뚜껑). 윗판(두께 10)에 안테나 M3 x 4(볼트 원 Ø40)와 목 구멍 Ø22.
          나사 구간 위는 반지름 46 의 둥근 공간이라 안테나 케이블을 넉넉히 감을 수 있다.
가정(실물 확인 필요): 원판 두께·폴 스터드 길이, 안테나 목 길이(바닥 아래로 13 mm 가정), 직각 USB 플러그가 아닌 일반 플러그(구멍 14x7).
"""
import math
import os
import re
import sys

import FreeCAD as App
import Part
import MeshPart

here = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else os.getcwd()

import builtins
_log = open(os.path.join(here, 'um982_mount_freecad.log'), 'w', encoding='utf-8')


def say(*a):
    """콘솔(cp949 등)이 한글을 못 찍어도 멈추지 않도록 UTF-8 로그 파일에 같이 남긴다."""
    s = ' '.join(str(x) for x in a)
    _log.write(s + chr(10))
    _log.flush()
    try:
        builtins.print(s)
    except Exception:
        builtins.print(s.encode('ascii', 'replace').decode())


# ───────────── 파라미터 (이름 = 스프레드시트 별칭). 값이 '=' 로 시작하는 문자열이면 계산식 ─────────────
PARAMS = [
    ('# 외형', None, None),
    ('D_out', 96.5, '바깥 지름 = 알루미늄 원판 지름'),
    ('H_total', 40.0, '조립 높이 (원판 윗면 ~ 안테나 바닥)'),
    ('floor_t', 3.0, '바닥 두께'),
    ('R_in', 42.0, '본체 안쪽 반지름'),
    ('# 병뚜껑 나사', None, None),
    ('z_sh', 14.0, '어깨(뚜껑이 닿는 높이) = 본체 큰 원통 높이'),
    ('thread_h', 12.0, '나사 구간 높이 (어깨 ~ 목 위끝)'),
    ('R_core', 44.0, '외나사 목(뿌리) 반지름'),
    ('thread_depth', 1.6, '나사산 높이'),
    ('thread_pitch', 4.0, '나사 피치'),
    ('thread_clr', 0.4, '나사 반경 여유(프린트 공차)'),
    ('neck_top_gap', 0.5, '목 위끝과 뚜껑 안쪽 사이 여유'),
    ('# 뚜껑 윗판 / 안테나', None, None),
    ('plate_t', 10.0, '윗판 두께'),
    ('neck_hole_d', 22.0, '안테나 목(Ø20)+케이블 구멍'),
    ('ear', 40 / math.sqrt(2) / 2, '안테나 M3 구멍 위치 ±(간격 28.28 = 볼트 원 Ø40)'),
    ('ant_pilot_d', 2.8, '안테나 M3 밑구멍 (열압입 인서트는 Ø4.2)'),
    ('ant_pilot_depth', 8.0, '안테나 M3 밑구멍 깊이'),
    ('# 보드 (UM982)', None, None),
    ('bd_L', 50.23, '보드 길이'), ('bd_W', 31.80, '보드 폭'), ('pcb_t', 1.6, '기판 두께'),
    ('hmax', 11.4, '기판 바닥에서 최고 높이'), ('hs', 4.0, '받침 높이'),
    ('hole_px', 44.9, '보드 구멍 간격(길이)'), ('hole_py', 27.2, '보드 구멍 간격(폭)'),
    ('top_clear', 1.5, '최고 부품 위 여유'),
    ('board_dy', 12.0, '보드를 뒤(+y)로 옮기는 거리 (SMA 앞 굽힘 공간)'),
    ('usb_y', 16.0, 'USB-C 중심 위치(보드 폭 방향)'), ('usb_h', 3.25, 'USB-C 커넥터 높이'),
    ('usb_w', 14.0, 'USB 구멍 폭'), ('usb_hh', 7.0, 'USB 구멍 높이'),
    ('post_d', 7.0, '받침 지름 (M3 셀프탭 둘레 벽 2 mm)'), ('pilot_m3', 2.6, '보드 M3 x 8 셀프탭 밑구멍 (관통, 열압입 인서트를 쓰면 4.2)'),
    ('# 바닥 5/8"-11 나사', None, None),
    ('stud_len', 7.0, '수나사 길이'), ('stud_major', 25.4 * 5 / 8, '나사 바깥 지름'),
    ('stud_pitch', 25.4 / 11, '피치(11 TPI)'), ('stud_clear', 0.35, '프린트 공차'),
    ('# 파생값 (계산식)', None, None),
    ('R_out', '=D_out / 2', '바깥 반지름'),
    ('pcb_b', '=floor_t + hs', '기판 바닥 높이'),
    ('pcb_top', '=pcb_b + pcb_t', '기판 윗면 높이'),
    ('hi', '=pcb_b + hmax', '최고 부품 높이'),
    ('z_bt', '=z_sh + thread_h', '목 위끝(나사 구간 끝)'),
    ('z_ceil', '=H_total - plate_t', '뚜껑 안쪽 천장(윗판 아랫면)'),
    ('R_maj', '=R_core + thread_depth', '외나사 바깥 반지름'),
    ('R_bore', '=R_maj + thread_clr', '뚜껑 안쪽 반지름(내나사 뿌리)'),
    ('R_crest_i', '=R_core + thread_clr', '내나사 산 끝 반지름'),
]

doc = App.newDocument('um982_mount')
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


def X(expr):
    """계산식 문자열의 파라미터 이름을 Params.<이름> 으로 바꿔 FreeCAD 식으로 만든다."""
    return re.sub(r'\b(%s)\b' % '|'.join(NAMES), r'Params.\1', expr)


def vec(x, y, z):
    return App.Vector(x, y, z)


def cyl(name, r, h, x=0.0, y=0.0, z=0.0):
    """원통. r, h, z 는 숫자 또는 파라미터 식 문자열, x/y 는 숫자."""
    o = doc.addObject('Part::Cylinder', name)
    zn = 0.0 if isinstance(z, str) else z
    o.Placement = App.Placement(vec(x, y, zn), App.Rotation())
    for prop, val in (('Radius', r), ('Height', h)):
        if isinstance(val, str):
            o.setExpression(prop, X(val))
        else:
            setattr(o, prop, val)
    if isinstance(z, str):
        o.setExpression('Placement.Base.z', X(z))
    return o


def box(name, x0, x1, y0, y1, z0, z1):
    o = doc.addObject('Part::Box', name)
    o.Length, o.Width, o.Height = x1 - x0, y1 - y0, z1 - z0
    o.Placement = App.Placement(vec(x0, y0, z0), App.Rotation())
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
    """나선을 따라 사다리꼴 산을 스윕한 솔리드(오른나사). 프로파일 위치는 파라미터에 연결.
    dx_tip: 뿌리(기준 반경)에서 산 끝까지 반경 방향 거리(+ 바깥, - 안쪽)."""
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


# ───────────────────────── 본체 ─────────────────────────
v = V
hl, hw = v['bd_L'] / 2, v['bd_W'] / 2
dy = v['board_dy']
holes = [(sx * v['hole_py'] / 2, sy * v['hole_px'] / 2 + dy) for sx in (-1, 1) for sy in (-1, 1)]   # (X, Y) 하우징 좌표
TW, TWT = 2.6, 0.6                                                                                  # 나사산 뿌리 폭 / 끝 폭

b_big = cyl('Body_Lower', 'R_out', 'z_sh')
b_neck = cyl('Body_Neck', 'R_core', 'z_bt - neck_top_gap - z_sh', z='z_sh')
b_thr = thread_ridge('Body_Thread', 'R_core - 0.2', 'z_sh + 1.5', 'thread_h - neck_top_gap - 3.0', 'thread_pitch',
                     0.2 + v['thread_depth'], TW, TWT)
b_outer = fuse('Body_Outer', [b_big, b_neck, b_thr])
b_cav = cyl('Body_Cavity', 'R_in', 'z_bt + 1 - floor_t', z='floor_t')
b_shell = cut('Body_Shell', b_outer, b_cav)
posts = [cyl('Post%d' % i, 'post_d / 2', 'hs + 0.01', x=px, y=py, z='floor_t - 0.01') for i, (px, py) in enumerate(holes)]
# 보드 M3 x 8: 기판 1.6 을 지나 받침 안에 6.4 mm 들어간다. 받침(4)+바닥(3)=7 이라 막힌 구멍이면 나사 끝이 걸리므로 바닥까지 관통(끝은 바닥면 0.6 위)
pil = [cyl('PostHole%d' % i, 'pilot_m3 / 2', 'floor_t + hs + 0.02', x=px, y=py, z=-0.01) for i, (px, py) in enumerate(holes)]
b_posts = fuse('Body_Posts', [b_shell] + posts)
b_pil = fuse('Body_PostHoles', pil)
b_a = cut('Body_WithPosts', b_posts, b_pil)
usb_c = v['usb_y'] - hw
zu = v['pcb_top'] + v['usb_h'] / 2
usb_cut = box('Body_UsbHole', usb_c - v['usb_w'] / 2, usb_c + v['usb_w'] / 2, hl + dy - 1.0, v['R_out'] + 1.0, zu - v['usb_hh'] / 2, zu + v['usb_hh'] / 2)
usb_cut.setExpression('Placement.Base.x', X('(usb_y - bd_W / 2) - usb_w / 2'))
usb_cut.setExpression('Length', X('usb_w'))
usb_cut.setExpression('Placement.Base.z', X('(pcb_top + usb_h / 2) - usb_hh / 2'))
usb_cut.setExpression('Height', X('usb_hh'))
b_b = cut('Body_WithUsb', b_a, usb_cut)
# 바닥 5/8"-11 수나사
st_core = cyl('Stud_Core', '(stud_major - stud_clear) / 2 - 1.35', 'stud_len + 0.5', z='-stud_len')
st_thr = thread_ridge('Stud_Thread', '(stud_major - stud_clear) / 2 - 1.35 - 0.1', '-stud_len + 1.0', 'stud_len - 1.0', 'stud_pitch',
                      1.35 + 0.1, 2.0, 0.25)
body = fuse('Body', [b_b, st_core, st_thr])

# ───────────────────────── 뚜껑 ─────────────────────────
l_out = cyl('Lid_Outer', 'R_out', 'H_total - z_sh', z='z_sh')
l_bore = cyl('Lid_Bore', 'R_bore', 'z_ceil - z_sh + 0.01', z='z_sh - 0.01')
l_a = cut('Lid_Shell', l_out, l_bore)
# 내나사: 벽에 0.2 파묻고 안쪽으로 돌출. 위상은 외나사 홈 가운데로(피치/2 어긋남)
l_thr = thread_ridge('Lid_Thread', 'R_bore + 0.2', 'z_sh + 1.5 + thread_pitch / 2', 'thread_h - neck_top_gap - 3.0', 'thread_pitch',
                     -(0.2 + v['thread_depth']), TW, TWT)
l_b = fuse('Lid_WithThread', [l_a, l_thr])
l_neck = cyl('Lid_NeckHole', 'neck_hole_d / 2', 'plate_t + 2', z='z_ceil - 0.01')
ear = v['ear']
l_pil = [cyl('Lid_AntHole%d' % i, 'ant_pilot_d / 2', 'ant_pilot_depth + 1', x=sx * ear, y=sy * ear, z='H_total - ant_pilot_depth')
         for i, (sx, sy) in enumerate([(-1, -1), (-1, 1), (1, -1), (1, 1)])]
l_cuts = fuse('Lid_Cuts', [l_neck] + l_pil)
lid = cut('Lid', l_b, l_cuts)

doc.recompute()
bad = [o.Name for o in doc.Objects if 'Invalid' in o.State or 'Error' in ' '.join(o.State)]
say('재계산 오류 객체:', bad or '없음')


# ───────────────────────── 검사 ─────────────────────────
def board_to_house(x0, x1, y0, y1, z0, z1):
    """보드 좌표(x=길이, y=폭, 원점=왼쪽 아래)의 상자를 하우징 좌표로(보드 +x(SMA) → 하우징 -y)."""
    return Part.makeBox(y1 - y0, x1 - x0, z1 - z0, vec(y0 - hw, -(x1 - hl) + dy, z0))


def keepout():
    pb, pt, hi_ = v['pcb_b'], v['pcb_top'], v['hi']
    parts = [board_to_house(0, v['bd_L'], 0, v['bd_W'], pb, pt),
             board_to_house(20.2, 42.0, 8.7, 24.6, pt, pt + 3.5),
             board_to_house(16.6, 24.9, v['bd_W'] - 5.0, v['bd_W'], pt, pt + 6.0),
             board_to_house(17.0, 28.0, 0.0, 5.0, pt, pt + 6.0),
             board_to_house(-0.9, 0.5, v['usb_y'] - 4.5, v['usb_y'] + 4.5, pt, pt + v['usb_h'])]
    for ys in (v['bd_W'] - 8.25, 8.25):
        parts.append(Part.makeCylinder(3.2, 14.0, vec(ys - hw, -(v['bd_L'] - 6 - hl) + dy, pb + 8.2), vec(0, -1, 0)))   # SMA 몸통(밖으로 8)
        parts.append(board_to_house(v['bd_L'] - 5.8, v['bd_L'], ys - 3.9, ys + 3.9, pt, hi_))                              # SMA 직각 몸체
    j1 = v['bd_W'] - 8.25
    parts.append(Part.makeCylinder(4.6, 7.0, vec(j1 - hw, -(v['bd_L'] + 8 - hl) + dy, pb + 8.2), vec(0, -1, 0)))     # 연결된 SMA 플러그
    parts.append(Part.makeCylinder(10.2, 13.0, vec(0, 0, v['H_total'] - 13.0)))                                    # 안테나 목
    k = parts[0]
    for p in parts[1:]:
        k = k.fuse(p)
    return k


KO = keepout()
for nm, o in (('본체', body), ('뚜껑', lid)):
    s = o.Shape
    say('%s: 솔리드 %d개, 유효 %s, 부피 %.0f mm³, 높이 %.1f..%.1f mm, 지름 %.1f' % (
        nm, len(s.Solids), s.isValid(), s.Volume, s.BoundBox.ZMin, s.BoundBox.ZMax, s.BoundBox.XLength))
say('겹침(0이어야 함): 본체∩부품영역 %.3f, 뚜껑∩부품영역 %.3f, 본체∩뚜껑 %.3f mm³' % (
    body.Shape.common(KO).Volume, lid.Shape.common(KO).Volume, body.Shape.common(lid.Shape).Volume))

for i, (px, py) in enumerate(holes):
    thru = Part.makeCylinder(v['pilot_m3'] / 2 - 0.02, v['floor_t'] + v['hs'] + 1.0, vec(px, py, -0.5))     # 밑구멍 안쪽을 지나는 가는 기둥
    wall = v['post_d'] / 2 - v['pilot_m3'] / 2
    gap = v['R_in'] - (math.hypot(px, py) + v['post_d'] / 2)
    say('받침%d: 위치 (%.1f, %.1f), 밑구멍 관통 확인(재료 %.3f mm³, 0이면 뚫림), 구멍 둘레 벽 %.2f mm, 하우징 안쪽 벽까지 간격 %.2f mm' % (
        i, px, py, body.Shape.common(thru).Volume, wall, gap))
tip_z = v['pcb_top'] - 8.0          # M3 x 8 나사 끝 높이 = 기판 윗면에서 8 mm 아래
say('M3 x 8: 기판 %.1f 를 지나 받침 속 %.1f mm 들어감, 나사 끝 높이 z=%.1f (바닥면 z=0 위 %.1f mm, 구멍은 관통)' % (
    v['pcb_t'], 8.0 - v['pcb_t'], tip_z, tip_z))

ref = doc.addObject('Part::Feature', 'Ref_BoardKeepout')
ref.Shape = KO
doc.recompute()
# 표시 설정: 최종 객체(본체·뚜껑·참고 영역)만 보이게, 중간 단계 객체는 숨김(겹쳐 보이는 것 방지)
FINAL = ('Body', 'Lid', 'Ref_BoardKeepout')
for o in doc.Objects:
    if o.Name != 'Params':
        o.Visibility = o.Name in FINAL
if App.GuiUp:
    ref.ViewObject.Transparency = 70
    ref.ViewObject.ShapeColor = (1.0, 0.2, 0.2)
    body.ViewObject.ShapeColor = (0.25, 0.5, 0.95)
    lid.ViewObject.ShapeColor = (0.95, 0.65, 0.2)

out_fcstd = os.path.join(here, 'um982_mount.FCStd')
doc.saveAs(out_fcstd)
say('저장:', out_fcstd)


def save_stl(shape, path, name):
    m = MeshPart.meshFromShape(Shape=shape, LinearDeflection=0.05, AngularDeflection=0.2)
    m.write(path)
    say('STL', name, m.CountFacets, '면 →', path)


def flip(shape, z_after):
    s = shape.copy()
    s.rotate(vec(0, 0, 0), vec(1, 0, 0), 180)
    s.translate(vec(0, 0, z_after))
    return s


save_stl(flip(body.Shape, v['z_bt']), os.path.join(here, 'um982_mount_body.stl'), '본체(나사가 위, 뒤집어 출력)')
save_stl(flip(lid.Shape, v['H_total']), os.path.join(here, 'um982_mount_lid.stl'), '뚜껑(윗판이 베드)')
