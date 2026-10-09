#!/usr/bin/env python3
"""BT-T009 안테나 ↔ 100mm 알루미늄 원판(5/8"-11 암나사) 연결 어댑터 (3D 프린트용)

입력 도면(핸드헬드RTK.dxf, BT-T009 평면도)에서 읽은 값:
  M3 구멍 Ø3.5 x 4: 중심 (15.000,-13.459) (15.000,14.826) (-13.284,14.826) (-13.284,-13.459) -> 간격 28.284 (= Ø40 원 위 정사각)
  귀 바깥 끝은 구멍 중심에서 4.857 -> 외곽 38.0 x 38.0, 링 Ø40, 본체 Ø30.6
요청: 안테나 체결부 두께 포함 높이 30 mm, 원판에 체결하는 볼트부가 약 7 mm 돌출.

구조(위에서 아래로, 설계 좌표 z=0 이 원판에 닿는 면):
  z 24~30  체결판   : 안테나 귀를 M3 로 체결(자리 구멍 Ø2.8, 깊이 8), 가운데 Ø22 = 안테나 목(Ø20) 통과
  z  5~24  속 빈 몸통: Ø24 공간에 안테나 목·케이블이 들어가고, 옆 창(폭 11)으로 케이블+SMA 커넥터를 뺀다
  z  0~ 5  바닥     : 원판과 맞닿는 면
  z -7~ 0  볼트부   : 5/8"-11 UNC 수나사(프린트 공차 적용) 7 mm

출력: antenna_mount.stl (출력 자세: 안테나 체결면이 베드, 볼트부가 위), antenna_mount.dxf (평면·단면 도면)
실행: python hardware/antenna_mount.py   (numpy 필요, DXF 도면은 ezdxf 가 있을 때만)
치수가 맞지 않으면 아래 P 를 고쳐 다시 실행하면 된다.
"""
import math
import os
import struct
import sys

import numpy as np

P = dict(
    hole_pitch=40.0 / math.sqrt(2),  # M3 구멍 중심 간격 28.284 = 구멍이 Ø40 원 위에 있는 정사각 배치 (DXF 구멍 원 4개의 중심으로 확인)
    shape='round',             # 'round'(원형, 기본) 또는 'square'(둥근 사각형)
    outer_d=50.0,              # 원형 지름: 귀 끝 반지름 24.86 을 덮고 구멍 둘레 벽 3.6 확보
    outer=40.0, corner_r=6.0,  # 사각형일 때 외곽(안테나 38 + 여유 1), 모서리 반지름 6 = 구멍 둘레 벽 확보
    height=30.0,               # 체결판 두께 포함 총 높이
    floor=5.0,                 # 바닥 두께
    plate=6.0,                 # 체결판 두께
    cavity_d=24.0,             # 속 공간 지름
    neck_hole_d=22.0,          # 체결판 가운데 구멍 (안테나 목 Ø20 + 여유)
    pilot_d=2.8, pilot_depth=8.0,  # M3 셀프탭 밑구멍
    window_w=11.0, window_h=15.0,  # 케이블/SMA 통과 창
    windows=(270,),                # 창 방향(도): 270=폴 정면(설계 -y, 평면도 아래). 4면 창은 (0, 90, 180, 270)
    stud_len=7.0, stud_major=25.4 * 5 / 8, stud_pitch=25.4 / 11, stud_clear=0.35,  # 5/8"-11 UNC, 프린트 공차 0.35
)


# ───────────── 2D 다각형 도구 ─────────────
def area2(p):
    a = 0.0
    for i in range(len(p)):
        x1, y1 = p[i]
        x2, y2 = p[(i + 1) % len(p)]
        a += x1 * y2 - x2 * y1
    return a / 2


def circle(cx, cy, r, n, cw=False):
    s = -1 if cw else 1
    return [(cx + r * math.cos(s * 2 * math.pi * i / n), cy + r * math.sin(s * 2 * math.pi * i / n)) for i in range(n)]


def outer_loop(w, r, n=12, extra_bottom=()):
    """반시계 둥근 사각형. 시작점 (c,-h). extra_bottom: 아래 변(마지막 구간)에 끼워 넣을 x 좌표들."""
    h = w / 2
    c = h - r
    pts = []
    for cx, cy, a0 in [(c, -c, -90), (c, c, 0), (-c, c, 90), (-c, -c, 180)]:
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    pts[-1] = (-c, -h)
    pts[0] = (c, -h)
    for x in sorted(extra_bottom):
        pts.append((x, -h))
    return pts


def outer_poly(p):
    """어댑터 바깥 윤곽(반시계)."""
    if p['shape'] == 'round':
        return circle(0, 0, p['outer_d'] / 2, 192)
    return outer_loop(p['outer'], p['corner_r'])


def half_size(p):
    return p['outer_d'] / 2 if p['shape'] == 'round' else p['outer'] / 2


def window_pieces(p, n=96):
    """옆 창(들)이 뚫린 벽 단면: 창 사이의 벽 조각마다 하나의 단순 다각형(반시계).
    p['windows']: 창 방향 각도(도). 270 = 설계 좌표 -y(평면도 아래쪽), 0=+x, 90=+y, 180=-x."""
    wins, win_w = p['windows'], p['window_w']
    h = half_size(p)
    R = p['cavity_d'] / 2
    hw = win_w / 2
    yc = math.sqrt(R * R - hw * hw)
    ho = math.sqrt(h * h - hw * hw) if p['shape'] == 'round' else h     # 창 모서리가 바깥 윤곽과 만나는 축 방향 거리
    TAU = 2 * math.pi
    ang = lambda x, y: math.atan2(y, x) % TAU

    def edge(phi, side):
        """창 phi 의 반시계쪽(+1)/시계쪽(-1) 모서리: (바깥 점, 속 원 점)."""
        u = (round(math.cos(math.radians(phi))), round(math.sin(math.radians(phi))))
        v = (-u[1], u[0])  # u 를 반시계로 90° 돌린 방향 = 반시계쪽
        return ((u[0] * ho + side * hw * v[0], u[1] * ho + side * hw * v[1]),
                (u[0] * yc + side * hw * v[0], u[1] * yc + side * hw * v[1]))

    outer = outer_poly(p)
    ws = sorted(set(p % 360 for p in wins))
    pieces = []
    for i, a in enumerate(ws):
        b = ws[(i + 1) % len(ws)]
        A_out, A_cav = edge(a, +1)
        B_out, B_cav = edge(b, -1)
        a0, a1 = ang(*A_out), ang(*B_out)
        span = (a1 - a0) % TAU or TAU
        pts = [A_out]
        mids = sorted(((ang(x, y) - a0) % TAU, (x, y)) for (x, y) in outer)
        for da, q in mids:
            if 1e-6 < da < span - 1e-6:
                pts.append(q)
        pts.append(B_out)
        pts.append(B_cav)
        c0, c1 = ang(*B_cav), ang(*A_cav)
        cspan = (c0 - c1) % TAU or TAU        # 속 원을 시계방향으로 돈다
        k = int(math.ceil(cspan / (TAU / n)))
        for j in range(1, k):
            t = c0 - cspan * j / k
            pts.append((R * math.cos(t), R * math.sin(t)))
        pts.append(A_cav)
        assert area2(pts) > 0
        pieces.append(pts)
    return pieces


def _seg_hit(p, q, A, B):
    """선분 pq 가 선분 배열 AB 와 '진짜로' 교차하는지(끝점 접촉 제외)."""
    d = np.array(q) - np.array(p)
    e = B - A
    den = d[0] * e[:, 1] - d[1] * e[:, 0]
    ap = A - np.array(p)
    with np.errstate(divide='ignore', invalid='ignore'):
        t = (ap[:, 0] * e[:, 1] - ap[:, 1] * e[:, 0]) / den
        u = (ap[:, 0] * d[1] - ap[:, 1] * d[0]) / den
    eps = 1e-9
    return (np.abs(den) > 1e-12) & (t > eps) & (t < 1 - eps) & (u > eps) & (u < 1 - eps)


def _inside(pt, poly):
    x, y = pt
    c = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def merge_holes(outer, holes):
    """구멍을 다리(bridge)로 바깥 다각형에 이어 하나의 다각형으로 만든다."""
    outer = list(outer)
    holes = [list(h) for h in holes]
    holes.sort(key=lambda h: -max(p[0] for p in h))
    while holes:
        h = holes.pop(0)
        mi = max(range(len(h)), key=lambda i: h[i][0])
        M = h[mi]
        edges = []
        for loop in [outer, h] + holes:
            for i in range(len(loop)):
                edges.append((loop[i], loop[(i + 1) % len(loop)]))
        A = np.array([e[0] for e in edges])
        B = np.array([e[1] for e in edges])
        order = sorted(range(len(outer)), key=lambda i: (outer[i][0] - M[0]) ** 2 + (outer[i][1] - M[1]) ** 2)
        for vi in order:
            V = outer[vi]
            if _seg_hit(M, V, A, B).any():
                continue
            mid = ((M[0] + V[0]) / 2, (M[1] + V[1]) / 2)
            if not _inside(mid, outer) or _inside(mid, h) or any(_inside(mid, o) for o in holes):
                continue
            outer = outer[:vi + 1] + h[mi:] + h[:mi + 1] + [V] + outer[vi + 1:]
            break
        else:
            raise RuntimeError('구멍 다리를 놓지 못했습니다')
    return outer


def earclip(poly):
    """단순 다각형(반시계) 삼각분할 -> [(i,j,k)...] (인덱스는 poly 기준)."""
    pts = np.array(poly)
    idx = list(range(len(poly)))
    tris = []
    guard = 0
    while len(idx) > 3:
        guard += 1
        if guard > 20000:
            raise RuntimeError('삼각분할 실패')
        n = len(idx)
        cut = False
        for k in range(n):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % n]
            a, b, c = pts[i0], pts[i1], pts[i2]
            cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
            if cr <= 1e-10:
                continue
            others = [j for j in idx if j not in (i0, i1, i2)]
            ok = True
            if others:
                q = pts[others]
                same = (np.abs(q - a).sum(1) < 1e-9) | (np.abs(q - b).sum(1) < 1e-9) | (np.abs(q - c).sum(1) < 1e-9)
                d1 = (q[:, 0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (q[:, 1] - b[1])
                d2 = (q[:, 0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (q[:, 1] - c[1])
                d3 = (q[:, 0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (q[:, 1] - a[1])
                inside = (d1 >= -1e-9) & (d2 >= -1e-9) & (d3 >= -1e-9) & ~same
                ok = not inside.any()
            if ok:
                tris.append((i0, i1, i2))
                idx.pop(k)
                cut = True
                break
        if not cut:  # 일직선 꼭짓점 제거
            for k in range(n):
                i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % n]
                a, b, c = pts[i0], pts[i1], pts[i2]
                if abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) <= 1e-10:
                    idx.pop(k)
                    cut = True
                    break
            if not cut:
                raise RuntimeError('귀(ear)를 찾지 못했습니다')
    tris.append(tuple(idx))
    return tris


# ───────────── 3D 메쉬 ─────────────
def slab(loops, z0, z1):
    """loops[0]=바깥(반시계), 나머지=구멍(시계). z0~z1 를 닫힌 껍질로 돌려준다. [(p,q,r)...] 3D 삼각형."""
    out = []
    outer = loops[0]
    merged = merge_holes(outer, loops[1:]) if len(loops) > 1 else list(outer)
    for i, j, k in earclip(merged):
        a, b, c = merged[i], merged[j], merged[k]
        out.append(((a[0], a[1], z1), (b[0], b[1], z1), (c[0], c[1], z1)))
        out.append(((a[0], a[1], z0), (c[0], c[1], z0), (b[0], b[1], z0)))
    for loop in loops:
        n = len(loop)
        for i in range(n):
            p, q = loop[i], loop[(i + 1) % n]
            if abs(p[0] - q[0]) < 1e-12 and abs(p[1] - q[1]) < 1e-12:
                continue
            out.append(((p[0], p[1], z0), (q[0], q[1], z0), (q[0], q[1], z1)))
            out.append(((p[0], p[1], z0), (q[0], q[1], z1), (p[0], p[1], z1)))
    return out


def stud(zb, zt, major, pitch, clear, nth=96):
    """5/8"-11 수나사 껍질(헬릭스). zb=끝, zt=몸통 안쪽 시작."""
    depth = 1.35
    rmaj = (major - clear) / 2
    rmin = rmaj - depth
    nz = int(math.ceil((zt - zb) / 0.1))
    zs = [zb + (zt - zb) * j / nz for j in range(nz + 1)]

    def prof(u):  # 60° 사다리꼴 산: 골 0.08 / 오르막 0.34 / 마루 0.16 / 내리막 0.34 / 골 0.08
        u %= 1.0
        if u < 0.08:
            return 0.0
        if u < 0.42:
            return (u - 0.08) / 0.34
        if u < 0.58:
            return 1.0
        if u < 0.92:
            return 1.0 - (u - 0.58) / 0.34
        return 0.0

    V = []
    for z in zs:
        row = []
        for i in range(nth):
            th = 2 * math.pi * i / nth
            r = rmin + depth * prof(z / pitch - th / (2 * math.pi))
            r = min(r, rmin - 0.3 + (z - zb) * 1.2)          # 끝단 모따기
            row.append((r * math.cos(th), r * math.sin(th), z))
        V.append(row)
    out = []
    for j in range(nz):
        for i in range(nth):
            a, b = V[j][i], V[j][(i + 1) % nth]
            c, d = V[j + 1][(i + 1) % nth], V[j + 1][i]
            out.append((a, b, c))
            out.append((a, c, d))
    cb, ct = (0.0, 0.0, zb), (0.0, 0.0, zt)
    for i in range(nth):
        out.append((ct, V[nz][i], V[nz][(i + 1) % nth]))
        out.append((cb, V[0][(i + 1) % nth], V[0][i]))
    return out


def build(p=P):
    H, fl, pl = p['height'], p['floor'], p['plate']
    R, Rn = p['cavity_d'] / 2, p['neck_hole_d'] / 2
    ph = p['hole_pitch'] / 2
    win_top = fl + p['window_h']
    pil_bot = H - p['pilot_depth']
    assert win_top <= pil_bot <= H - pl, '창 높이·밑구멍 깊이·체결판 두께가 겹칩니다'
    outer = outer_poly(p)
    pilots = [circle(sx * ph, sy * ph, p['pilot_d'] / 2, 24, cw=True) for sx in (-1, 1) for sy in (-1, 1)]
    cavity = circle(0, 0, R, 96, cw=True)
    neck = circle(0, 0, Rn, 96, cw=True)
    cuts = sorted(set([0.0, fl, win_top, pil_bot, H - pl, H]))
    tris, shells = [], []
    for z0, z1 in zip(cuts[:-1], cuts[1:]):
        zm = (z0 + z1) / 2
        if zm < fl:
            loopsets = [[outer]]
        elif zm < H - pl:
            if zm < win_top:
                loopsets = [[pc] for pc in window_pieces(p)]
            else:
                loopsets = [[outer, cavity] + (pilots if zm > pil_bot else [])]
        else:
            loopsets = [[outer, neck] + pilots]
        for loops in loopsets:
            assert area2(loops[0]) > 0
            s = slab(loops, z0, z1)
            shells.append(s)
            tris += s
    st = stud(-p['stud_len'], 0.5, p['stud_major'], p['stud_pitch'], p['stud_clear'])
    shells.append(st)
    tris += st
    return tris, shells


def to_print_orientation(tris, height):
    """x 축 기준 180° 회전: 안테나 체결면(z=height)이 베드(z=0), 볼트부가 위로."""
    return [tuple((x, -y, height - z) for (x, y, z) in t) for t in tris]


def write_stl(path, tris, name='antenna_mount'):
    with open(path, 'wb') as f:
        f.write(name.encode()[:80].ljust(80, b' '))
        f.write(struct.pack('<I', len(tris)))
        for t in tris:
            a, b, c = (np.array(v) for v in t)
            n = np.cross(b - a, c - a)
            ln = np.linalg.norm(n)
            n = n / ln if ln > 0 else n
            f.write(struct.pack('<12fH', *n, *a, *b, *c, 0))


def check(shells):
    """껍질별 위상 검사: 모든 모서리가 정확히 한 번씩 반대 방향으로 쓰였는가, 부피."""
    res = []
    for s in shells:
        edges = {}
        vol = 0.0
        key = lambda v: (round(v[0], 5), round(v[1], 5), round(v[2], 5))
        for t in s:
            a, b, c = (np.array(v) for v in t)
            vol += np.dot(a, np.cross(b, c)) / 6
            for u, w in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
                e = (key(u), key(w))
                edges[e] = edges.get(e, 0) + 1
        bad = sum(1 for (u, w), cnt in edges.items() if cnt != 1 or edges.get((w, u), 0) != 1)
        res.append((len(s), bad, vol))
    return res


# ───────────── 도면(DXF) ─────────────
def write_dxf(path, p=P):
    try:
        import ezdxf
    except ImportError:
        print('ezdxf 가 없어 DXF 도면은 건너뜁니다')
        return
    d = ezdxf.new('R2010', setup=True)
    d.units = 4  # mm
    for name, col in (('OUT', 7), ('HID', 8), ('ANT', 3), ('DIM', 1)):
        d.layers.add(name, color=col)
    d.layers.get('HID').dxf.linetype = 'DASHED'
    msp = d.modelspace()
    H, fl, pl = p['height'], p['floor'], p['plate']
    R, Rn = p['cavity_d'] / 2, p['neck_hole_d'] / 2
    ph = p['hole_pitch'] / 2
    w = 2 * half_size(p)     # 외곽 전체 폭(원형이면 지름)
    # 평면도 (원점 0,0)
    msp.add_lwpolyline(outer_poly(p), close=True, dxfattribs={'layer': 'OUT'})
    msp.add_circle((0, 0), Rn, dxfattribs={'layer': 'OUT'})
    msp.add_circle((0, 0), R, dxfattribs={'layer': 'HID'})
    msp.add_circle((0, 0), 20, dxfattribs={'layer': 'ANT'})
    msp.add_circle((0, 0), 15.3, dxfattribs={'layer': 'ANT'})
    for sx in (-1, 1):
        for sy in (-1, 1):
            msp.add_circle((sx * ph, sy * ph), 4.857, dxfattribs={'layer': 'ANT'})      # 안테나 귀(구멍 중심에서 바깥 끝까지 4.857)
            msp.add_circle((sx * ph, sy * ph), p['pilot_d'] / 2, dxfattribs={'layer': 'OUT'})
    hw = p['window_w'] / 2
    for phi in p['windows']:
        th = math.radians(phi - 270)                              # 기준 도형은 -y(270°) 창
        c, s_ = round(math.cos(th)), round(math.sin(th))
        rot = lambda x, y: (x * c - y * s_, x * s_ + y * c)
        msp.add_lwpolyline([rot(-hw, -w / 2), rot(-hw, -R), rot(hw, -R), rot(hw, -w / 2)], dxfattribs={'layer': 'HID'})
    msp.add_linear_dim(base=(0, w / 2 + 8), p1=(-ph, ph), p2=(ph, ph), override={'dimtxt': 1.5}, dxfattribs={'layer': 'DIM'}).render()
    msp.add_linear_dim(base=(0, -w / 2 - 8), p1=(-w / 2, 0), p2=(w / 2, 0), override={'dimtxt': 1.5}, dxfattribs={'layer': 'DIM'}).render()
    # 단면도 (x 방향 단면, 평면도 오른쪽에 배치). 가로=x, 세로=z(위가 +z)
    ox = w / 2 + 40

    def seg(x0, x1, z0, z1):
        msp.add_lwpolyline([(ox + x0, z0), (ox + x1, z0), (ox + x1, z1), (ox + x0, z1)], close=True, dxfattribs={'layer': 'OUT'})

    hh = w / 2
    seg(-hh, -R, 0, H - pl)
    seg(R, hh, 0, H - pl)
    seg(-hh, -Rn, H - pl, H)
    seg(Rn, hh, H - pl, H)
    seg(-R, R, 0, fl)
    sm = p['stud_major'] / 2
    msp.add_lwpolyline([(ox - sm, 0), (ox - sm, -p['stud_len']), (ox + sm, -p['stud_len']), (ox + sm, 0)], dxfattribs={'layer': 'OUT'})
    msp.add_linear_dim(base=(ox + hh + 6, 0), p1=(ox + hh, 0), p2=(ox + hh, H), angle=90, override={'dimtxt': 1.5}, dxfattribs={'layer': 'DIM'}).render()
    msp.add_linear_dim(base=(ox + hh + 14, 0), p1=(ox + hh, -p['stud_len']), p2=(ox + hh, 0), angle=90, override={'dimtxt': 1.5}, dxfattribs={'layer': 'DIM'}).render()
    msp.add_text('PLAN (top)  4xM3 pilot D%.1f, pitch %.3f' % (p['pilot_d'], p['hole_pitch']), height=1.6, dxfattribs={'layer': 'OUT', 'insert': (-w / 2, w / 2 + 14)})
    msp.add_text('SECTION  H=%.0f, stud 5/8-11 UNC x %.0f' % (H, p['stud_len']), height=1.6, dxfattribs={'layer': 'OUT', 'insert': (ox - hh, H + 4)})
    d.saveas(path)


def coupon(p=P, clears=(0.25, 0.35, 0.45)):
    """나사 공차 시험편: 지름 22 x 3 mm 받침 위에 5/8"-11 수나사 7 mm. 공차를 다르게 3개(왼쪽부터 clears, x=-26/0/+26)를 한 판에 만든다."""
    tris = []
    for i, cl in enumerate(clears):
        dx = (i - 1) * 26
        base = slab([circle(0, 0, 11, 96)], 0, 3)
        st = stud(-p['stud_len'], 0.5, p['stud_major'], p['stud_pitch'], cl)
        tris += [tuple((x + dx, y, z) for (x, y, z) in t) for t in base + st]
    return tris


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')   # Windows 콘솔(cp1252)에서도 한글 출력
    except Exception:
        pass
    here = os.path.dirname(os.path.abspath(__file__))
    if 'coupon' in sys.argv:                          # python hardware/antenna_mount.py coupon
        tris = coupon()
        write_stl(os.path.join(here, 'thread_test.stl'), to_print_orientation(tris, 3.0), 'thread_test')
        print('thread_test.stl 저장: 왼쪽부터 공차 0.25(꽉 낌) / 0.35(기본) / 0.45(헐렁)')
        return
    variants = [('antenna_mount', (270,)),                 # 정면 창 1개
                ('antenna_mount_4window', (0, 90, 180, 270))]  # 4면 창: 조인 각도와 무관하게 정면에 가장 가까운 창으로 케이블을 뺀다
    for name, wins in variants:
        p = dict(P, windows=wins)
        tris, shells = build(p)
        print('[%s] 창 방향 %s' % (name, wins))
        for i, (n, bad, vol) in enumerate(check(shells)):
            print('  껍질 %d: 삼각형 %d, 비정상 모서리 %d, 부피 %.1f mm³' % (i, n, bad, vol))
        write_stl(os.path.join(here, name + '.stl'), to_print_orientation(tris, p['height']))
        try:
            write_dxf(os.path.join(here, name + '.dxf'), p)
        except PermissionError:      # CAD 에서 열려 있으면 덮어쓸 수 없다 -> 옆 파일로 저장
            alt = os.path.join(here, name + '.new.dxf')
            write_dxf(alt, p)
            print('  ⚠ %s.dxf 가 다른 프로그램에서 열려 있어 %s 로 저장했습니다' % (name, os.path.basename(alt)))
        xs = np.array([v for t in tris for v in t])
        print('  치수(설계 좌표) x %.2f~%.2f  y %.2f~%.2f  z %.2f~%.2f' % (xs[:, 0].min(), xs[:, 0].max(), xs[:, 1].min(), xs[:, 1].max(), xs[:, 2].min(), xs[:, 2].max()))
    print('저장 폴더:', here)


if __name__ == '__main__':
    sys.exit(main())
