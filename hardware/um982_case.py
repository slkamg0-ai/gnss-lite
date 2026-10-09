#!/usr/bin/env python3
"""UM982 보드(50.23 x 31.80 mm) 3D 프린트 케이스 — 본체 2종(스트랩형 / 평면 부착형) + 공용 뚜껑.
필요: pip install manifold3d numpy  (3D 불리언 연산 라이브러리)

좌표(조립 상태): 원점 = 기판 왼쪽 아래 모서리. 기판을 위에서 볼 때 USB-C 가 왼쪽, SMA 가 오른쪽,
x = 길이, y = 폭(위쪽 = J1 주안테나 쪽), z = 본체 바닥에서 위로.

실측값(사용자): 기판 50.23 x 31.80, 고정 구멍 중심 간격 44.9 x 27.2, 기판 바닥에서 최고 높이 11.4(= SMA 원통 윗끝),
기판 아래 핀 돌출 3, SMA 중심 높이 8.2(기판 바닥 기준), 몸통 지름 6.4, 기판 밖 돌출 8, SMA 중심은 모서리에서 8.25,
USB-C 중심 16 / 9 x 3.25, 아래(y=0) 6핀 헤더 x 17~28(폭 11, 높이 6).
추정값(실측 필요): 고정 구멍 지름(M2 나사만 통과하면 됨).

조립: 기판을 4개 받침 위에 놓고, 뚜껑의 속 빈 기둥이 기판 위에서 누르며 M2 나사 4개가 뚜껑 → 기판 구멍 → 받침을 한 번에 조인다.
실행: python hardware/um982_case.py
"""
import os
import sys

import manifold3d as mf
import numpy as np

M, CS = mf.Manifold, mf.CrossSection

C = dict(
    L=50.23, W=31.80, pcb_t=1.6, hmax=11.4, hs=4.0,                    # hs: 받침 높이(아래 핀 3 + 여유 1)
    hole_pitch=(44.9, 27.2), sma_axis=8.2, sma_barrel=6.4, sma_hole_extra=1.0, sma_out=8.0, sma_ys=(31.80 - 8.25, 8.25),
    usb_y=16.0, usb_open=(13.2, 7.0), usb_h=3.25,                      # 케이블 머리(몰딩)가 통과하도록 구멍은 넓게
    uart_x=(17.0, 28.0), uart_pad=1.2, uart_h=7.5,                     # 아래(y=0)쪽 6핀 헤더 케이블 슬롯
    post_d=4.4, pilot_d=1.7, tube_od=5.0, tube_od_right=3.8, tube_id=2.3, head_d=4.4, head_depth=1.0,   # 오른쪽 구멍은 SMA 몸체와 가까워 가는 기둥
    sma_block=(5.8, 7.8),                                              # SMA 직각 몸체 크기(기판 가장자리에서 안쪽 길이 x 폭) — 사진으로 추정
    gap_usb=0.4, gap_sma=0.3, gap_y=0.5, wall=2.0, wall_sma=1.6, top_clear=1.5, r_out=3.0, r_in=1.0,
    floor_pad=2.4, pocket=(40.0, 25.0), pocket_d=1.0,                  # 평면 부착형: 벨크로(후크) 자리
    floor_strap=6.6, tunnel=[(1.5, 3.2, 11.0), (3.2, 3.9, 9.0), (3.9, 4.6, 7.0)],   # 스트랩형: 폭 22 터널, 천장은 계단형(서포트 없이 출력)
    plate=2.0, lip_h=1.0, lip_t=1.2, lip_clear=0.25, text_depth=0.6,
)


def box(x0, x1, y0, y1, z0, z1):
    return M.cube((x1 - x0, y1 - y0, z1 - z0)).translate((x0, y0, z0))


def rprism(x0, x1, y0, y1, z0, z1, r):
    cs = CS.square((x1 - x0 - 2 * r, y1 - y0 - 2 * r)).translate((x0 + r, y0 + r)).offset(r, mf.JoinType.Round, 2.0, 48)
    return M.extrude(cs, z1 - z0).translate((0, 0, z0))


def cyl_z(cx, cy, r, z0, z1, seg=48):
    return M.cylinder(z1 - z0, r, circular_segments=seg).translate((cx, cy, z0))


def cyl_x(y, z, r, x0, x1, seg=64):
    return M.cylinder(x1 - x0, r, circular_segments=seg).rotate((0, 90, 0)).translate((x0, y, z))


def union(parts):
    return M.batch_boolean(list(parts), mf.OpType.Add)


def geom(c, kind):
    g = {}
    g['z0'] = c['floor_strap'] if kind == 'strap' else c['floor_pad']
    g['pcb_b'] = g['z0'] + c['hs']
    g['pcb_t'] = g['pcb_b'] + c['pcb_t']
    g['hi'] = g['pcb_b'] + c['hmax']
    g['zc'] = g['hi'] + c['top_clear']
    g['ix0'], g['ix1'] = -c['gap_usb'], c['L'] + c['gap_sma']
    g['iy0'], g['iy1'] = -c['gap_y'], c['W'] + c['gap_y']
    g['ox0'], g['ox1'] = g['ix0'] - c['wall'], g['ix1'] + c['wall_sma']
    g['oy0'], g['oy1'] = g['iy0'] - c['wall'], g['iy1'] + c['wall']
    px, py = c['hole_pitch']
    cx, cy = c['L'] / 2, c['W'] / 2
    g['holes'] = [(cx + sx * px / 2, cy + sy * py / 2) for sx in (-1, 1) for sy in (-1, 1)]
    g['pilot_bottom'] = c['pocket_d'] if kind == 'pad' else c['tunnel'][-1][1]
    return g


def base(c, kind):
    g = geom(c, kind)
    z0, zc = g['z0'], g['zc']
    body = rprism(g['ox0'], g['ox1'], g['oy0'], g['oy1'], 0, zc, c['r_out'])
    body = body - rprism(g['ix0'], g['ix1'], g['iy0'], g['iy1'], z0, zc + 1, c['r_in'])
    posts = union(cyl_z(hx, hy, c['post_d'] / 2, z0 - 0.01, z0 + c['hs']) for hx, hy in g['holes'])
    body = body + posts
    body = body - union(cyl_z(hx, hy, c['pilot_d'] / 2, g['pilot_bottom'], z0 + c['hs'] + 0.01, 24) for hx, hy in g['holes'])
    # 개구부
    uw, uh = c['usb_open']
    zu = g['pcb_t'] + c['usb_h'] / 2
    body = body - box(g['ox0'] - 1, g['ix0'] + 0.5, c['usb_y'] - uw / 2, c['usb_y'] + uw / 2, zu - uh / 2, zu + uh / 2)
    zs = g['pcb_b'] + c['sma_axis']
    rs = (c['sma_barrel'] + c['sma_hole_extra']) / 2
    body = body - union(cyl_x(y, zs, rs, g['ix1'] - 0.5, g['ox1'] + 1) for y in c['sma_ys'])
    ux0, ux1 = c['uart_x'][0] - c['uart_pad'], c['uart_x'][1] + c['uart_pad']
    body = body - box(ux0, ux1, g['oy0'] - 1, g['iy0'] + 0.5, g['pcb_t'] - 0.3, g['pcb_t'] + c['uart_h'])
    # 바닥 고정부
    if kind == 'pad':
        pk_x, pk_y = c['pocket']
        body = body - box(c['L'] / 2 - pk_x / 2, c['L'] / 2 + pk_x / 2, c['W'] / 2 - pk_y / 2, c['W'] / 2 + pk_y / 2, -1, c['pocket_d'])
    else:
        xc = c['L'] / 2
        body = body - union(box(xc - hw, xc + hw, g['oy0'] - 1, g['oy1'] + 1, za, zb) for za, zb, hw in c['tunnel'])
    return body, g


GLYPH = {
    'J': ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
    '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
    'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
}


def text_cells(txt, x0, ytop, z0, z1):
    out = []
    for i, ch in enumerate(txt):
        for r, row in enumerate(GLYPH[ch]):
            for k, bit in enumerate(row):
                if bit == '1':
                    cx, cy = x0 + i * 6 + k, ytop - (r + 1)
                    out.append(box(cx - 0.02, cx + 1.02, cy - 0.02, cy + 1.02, z0, z1))      # 도트가 이어져 선처럼 보이게 살짝 겹침
    return out


def lid(c, g):
    zc, top = g['zc'], g['zc'] + c['plate']
    plate = rprism(g['ox0'], g['ox1'], g['oy0'], g['oy1'], zc, top, c['r_out'])
    lx0, lx1 = g['ix0'] + c['lip_clear'], g['ix1'] - c['lip_clear']
    ly0, ly1 = g['iy0'] + c['lip_clear'], g['iy1'] - c['lip_clear']
    lip = rprism(lx0, lx1, ly0, ly1, zc - c['lip_h'], zc + 0.01, c['r_in'] - 0.2) - rprism(lx0 + c['lip_t'], lx1 - c['lip_t'], ly0 + c['lip_t'], ly1 - c['lip_t'], zc - c['lip_h'] - 1, zc + 1, 0.5)
    tubes = union(cyl_z(hx, hy, (c['tube_od'] if hx < c['L'] / 2 else c['tube_od_right']) / 2, g['pcb_t'], zc + 0.01, 40) for hx, hy in g['holes'])
    body = plate + lip + tubes
    body = body - union(cyl_z(hx, hy, c['tube_id'] / 2, g['pcb_t'] - 1, top + 1, 24) for hx, hy in g['holes'])
    body = body - union(cyl_z(hx, hy, c['head_d'] / 2, top - c['head_depth'], top + 1, 32) for hx, hy in g['holes'])
    cells = text_cells('J1=M', 22.5, 26.0, top - c['text_depth'], top + 1) + text_cells('J3=S', 22.5, 11.5, top - c['text_depth'], top + 1)
    body = body - union(cells)
    return body, top


def to_print_orientation(m, top):
    return m.rotate((180, 0, 0)).translate((0, 0, top))            # x축 기준 180° 회전: 바깥(윗)면이 베드


def save_stl(m, path, name):
    mesh = m.to_mesh()
    v = np.asarray(mesh.vert_properties)[:, :3].astype(np.float32)
    t = np.asarray(mesh.tri_verts)
    tri = v[t]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    n = np.where(ln > 0, n / np.where(ln > 0, ln, 1), 0).astype(np.float32)
    rec = np.zeros(len(t), dtype=[('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')])
    rec['n'], rec['v'] = n, tri
    with open(path, 'wb') as f:
        f.write(name.encode()[:80].ljust(80, b' '))
        f.write(np.uint32(len(t)).tobytes())
        f.write(rec.tobytes())


def info(tag, m):
    b = m.bounding_box()
    print('[%s] 삼각형 %d, 상태 %s, 부피 %.0f mm³, 외형 %.1f x %.1f x %.1f mm' % (tag, m.num_tri(), m.status().name, m.volume(), b[3] - b[0], b[4] - b[1], b[5] - b[2]))


def board_keepout(c, g):
    """기판 + 부품이 차지하는 영역(최고 높이 포함 상자, SMA 원통 8 mm 돌출). 케이스가 여기와 겹치면 안 된다."""
    pcb = box(0, c['L'], 0, c['W'], g['pcb_b'], g['pcb_t'])
    parts = box(0, c['L'], 0, c['W'], g['pcb_t'], g['hi'])
    zs = g['pcb_b'] + c['sma_axis']
    barrels = union(cyl_x(y, zs, c['sma_barrel'] / 2, c['L'] - 6, c['L'] + c['sma_out']) for y in c['sma_ys'])
    usb = box(-0.9, 0.5, c['usb_y'] - 4.5, c['usb_y'] + 4.5, g['pcb_t'], g['pcb_t'] + c['usb_h'])
    bl, bw = c['sma_block']
    blocks = union(box(c['L'] - bl, c['L'], y - bw / 2, y + bw / 2, g['pcb_t'], g['hi']) for y in c['sma_ys'])
    # 기판 윗면의 큰 부품만 검사(모서리 구멍 주변은 낮은 칩 부품만 있는 것으로 봄): 모듈, 헤더 2개, USB-C, SMA 몸체
    module = box(20.2, 42.0, 8.7, 24.6, g['pcb_t'], g['pcb_t'] + 3.5)           # 사진에서 읽은 위치
    hdr_top = box(16.6, 24.9, c['W'] - 5.0, c['W'], g['pcb_t'], g['pcb_t'] + 6.0)
    hdr_bot = box(17.0, 28.0, 0.0, 5.0, g['pcb_t'], g['pcb_t'] + 6.0)
    return pcb + module + hdr_top + hdr_bot + barrels + usb + blocks


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    here = os.path.dirname(os.path.abspath(__file__))
    out = {}
    for kind, name in (('strap', 'um982_case_strap_base'), ('pad', 'um982_case_pad_base')):
        b, g = base(C, kind)
        info(name, b)
        save_stl(b, os.path.join(here, name + '.stl'), name)
        l, top = lid(C, g)
        ko = board_keepout(C, g)
        ov_b = (b ^ ko).volume()                                       # ^ = 교집합
        ov_l = (l ^ ko).volume()
        print('   겹침 검사(기판·부품 영역과): 본체 %.3f mm³, 뚜껑 %.3f mm³ (0이어야 함)' % (ov_b, ov_l))
        out[kind] = (g, top, l)
        avail = (top - C['head_depth']) - g['pilot_bottom'] - 0.4
        for L_ in (20, 18, 16, 14, 12):
            tip = (top - C['head_depth']) - L_
            if L_ <= avail and (g['pcb_b'] - tip) >= 4.0:
                print('   권장 나사: M2 x %d (끝이 받침 안으로 %.1f mm 들어감, 머리 자리 깊이 %.1f)' % (L_, g['pcb_b'] - tip, C['head_depth']))
                break
        print('   총높이(뚜껑 포함) %.1f mm, 케이스 바깥 %.1f x %.1f mm' % (top, g['ox1'] - g['ox0'], g['oy1'] - g['oy0']))
    # 뚜껑 모양은 두 본체에서 같다(바닥 높이만 다르고 기판 기준 치수는 같음) → 하나만 저장
    g, top, l = out['pad']
    lp = to_print_orientation(l, top)
    info('um982_case_lid', lp)
    save_stl(lp, os.path.join(here, 'um982_case_lid.stl'), 'um982_case_lid')
    print('SMA 몸통은 벽 밖으로 %.1f mm 나옴(= %.1f - 간극 %.1f - 벽 %.1f)' % (C['sma_out'] - C['gap_sma'] - C['wall_sma'], C['sma_out'], C['gap_sma'], C['wall_sma']))


if __name__ == '__main__':
    main()
