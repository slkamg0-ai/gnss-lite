#!/usr/bin/env python3
"""UM982 보드를 세워 넣는 일체형 하우징(타워형) — 폴 → 원판 → [하우징 + 안테나 직결].
필요: pip install manifold3d numpy

구조(초안, 출력·조립 전)
  - 본체: 지름 52 mm 원통. 바닥 중앙에 5/8"-11 수나사(7 mm, 원판 중앙 구멍으로), 윗판(두께 10)에 안테나 M3 x 4 를 직접 체결.
          안테나 케이블은 윗판 가운데 구멍(Ø22)으로 내려와 보드 SMA 에 꽂히고, 남는 길이는 보드 위 공간에 감는다.
  - 보드: 세워서(SMA 위, USB-C 아래) 뒷벽 받침 4개에 M2 x 6 으로 고정. USB-C 는 아래 방향이라 직각(L자) 케이블 권장.
  - 앞 덮개: 앞이 열려 있고, 덮개를 M3 x 8 나사 8개(좌우 2 x 위아래 4)로 닫는다. 덮개 아래쪽에 USB 케이블이 나가는 슬롯.

좌표: 원점 = 원판 윗면 중심, z 위. 앞(덮개) = -y, 뒤 = +y. 보드: 길이 방향 = z (SMA 가 위), 폭 방향 = x (J1 이 +x), 부품면이 앞(-y).
가정(실물 확인 필요): 안테나 목(Ø20)이 바닥 아래로 나오는 길이(neck_len), 직각 USB 플러그 높이(usb_below), SMA 플러그 길이.
실행: python hardware/um982_tower.py
"""
import math
import os
import sys

import manifold3d as mf
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import antenna_mount as am
import um982_case as uc

M = mf.Manifold
box, cyl_z, union, save_stl, info = uc.box, uc.cyl_z, uc.union, uc.save_stl, uc.info

C = uc.C
K = dict(
    r_out=26.0, r_in=22.0,                     # 바깥/안쪽 반지름 (안테나 귀 끝 반지름 24.9 를 덮음)
    floor=3.0,
    stud_len=7.0, stud_major=25.4 * 5 / 8, stud_pitch=25.4 / 11, stud_clear=0.35,
    usb_below=14.0,                            # 보드 아래 끝 ~ 바닥: 직각 USB-C 플러그가 들어갈 높이 (일자 케이블이면 약 28)
    y_back=6.0, y_cover=-11.0,                 # 뒷벽 받침면 y, 덮개 안쪽 면 y (SMA 플러그 안전 반경 4.6 이 닿지 않게)
    hs=4.0,                                    # 받침 길이 (아래 핀 3 + 여유 1)
    plug_over=7.0, bend=6.0, neck_len=13.0,    # SMA 플러그가 끝에서 더 올라오는 길이, 굽힘 여유, 안테나 목 길이(Ø20, 바닥 아래로)
    plate_t=10.0, neck_hole_d=22.0, ear=40.0 / math.sqrt(2) / 2, pilot_d=2.8, pilot_depth=8.0,   # 윗판
    post_d=4.4, pilot_m2=1.7,
    cover_x=21.4, cover_z=(10.0, 35.0, 60.0, 85.0), cover_hole_d=3.4, cover_cb_d=6.0, cover_cb=1.8, cover_pilot_d=2.6, cover_pilot=5.5,
    usb_slot=(20.0, 12.0),                     # 덮개의 USB 케이블 슬롯 (폭 x, 높이 z)
)


def cyl_y(x, z, r, y0, y1, seg=32):
    return M.cylinder(y1 - y0, r, circular_segments=seg).rotate((-90, 0, 0)).translate((x, y0, z))


def geom():
    g = {}
    L, W = C['L'], C['W']
    g['z_b'] = K['floor'] + K['usb_below']
    g['z_t'] = g['z_b'] + L
    g['y_pcb'] = K['y_back'] - K['hs']                           # 기판 바닥면(핀 쪽) y
    g['z_pl'] = g['z_t'] + C['sma_out'] + K['plug_over'] + K['bend'] + (K['neck_len'] - K['plate_t'])   # 윗판 아랫면
    g['z_top'] = g['z_pl'] + K['plate_t']
    g['sma_x'] = [y - W / 2 for y in C['sma_ys']]                # J1(+), J3(-)
    g['sma_y'] = g['y_pcb'] - C['sma_axis']
    hx = C['hole_pitch'][1] / 2
    z0 = g['z_b'] + (L - C['hole_pitch'][0]) / 2
    g['holes'] = [(sx * hx, z0 + k * C['hole_pitch'][0]) for sx in (-1, 1) for k in (0, 1)]   # (x, z)
    g['coil_z0'] = g['z_t'] + 4.0
    return g


def mesh_to_manifold(tris):
    idx, verts, faces = {}, [], []
    for t in tris:
        f = []
        for v in t:
            key = (round(v[0], 6), round(v[1], 6), round(v[2], 6))
            if key not in idx:
                idx[key] = len(verts)
                verts.append(key)
            f.append(idx[key])
        faces.append(f)
    vp = np.array(verts, dtype=np.float32)
    tv = np.array(faces, dtype=np.uint32)
    m = M(mf.Mesh(vert_properties=vp, tri_verts=tv))
    if m.status().name != 'NoError' or m.volume() < 0:
        m = M(mf.Mesh(vert_properties=vp, tri_verts=tv[:, ::-1].copy()))
    return m


def tube_parts(g):
    """본체와 덮개를 같이 만든다."""
    R, Ri, zt = K['r_out'], K['r_in'], g['z_top']
    outer = cyl_z(0, 0, R, 0, zt, 128)
    cavity = cyl_z(0, 0, Ri, K['floor'], g['z_pl'], 128)
    shell = outer - cavity
    # 뒷벽 받침: 보드 구간만 원 안쪽을 평평하게 채운다
    back = cyl_z(0, 0, Ri + 0.01, g['z_b'] - 2.0, g['z_t'] + 4.0, 128) ^ box(-R, R, K['y_back'], R, 0, zt)
    body = shell + back
    # 보드 받침(+M2 밑구멍): 앞쪽(-y)으로 hs 만큼
    posts = union(cyl_y(x, z, K['post_d'] / 2, g['y_pcb'], K['y_back'] + 0.01) for x, z in g['holes'])
    body = body + posts
    body = body - union(cyl_y(x, z, K['pilot_m2'] / 2, g['y_pcb'] - 0.01, g['y_pcb'] + 3.5, 24) for x, z in g['holes'])
    # 윗판: 안테나 목 구멍 + M3 밑구멍(위에서)
    body = body - cyl_z(0, 0, K['neck_hole_d'] / 2, g['z_pl'] - 0.01, zt + 1, 64)
    e = K['ear']
    body = body - union(cyl_z(sx * e, sy * e, K['pilot_d'] / 2, zt - K['pilot_depth'], zt + 0.01, 24) for sx in (-1, 1) for sy in (-1, 1))
    # 덮개 영역 분리: y < y_cover, z 는 바닥 위 ~ 윗판 아래
    zone = box(-R - 1, R + 1, -R - 1, K['y_cover'], K['floor'], g['z_pl'])
    cover = (outer ^ zone) - cyl_z(0, 0, Ri, g['coil_z0'], g['z_pl'] + 1, 128)     # 케이블 감는 구간은 속을 비움
    body = body - zone
    # 덮개 나사: 덮개 관통 + 머리 자리, 본체 밑구멍
    for sx in (-1, 1):
        for z in K['cover_z']:
            x = sx * K['cover_x']
            ys = -math.sqrt(max(R * R - x * x, 0))                 # 이 x 에서 바깥 표면 y
            cover = cover - cyl_y(x, z, K['cover_hole_d'] / 2, -R - 1, K['y_cover'] + 0.01, 24)
            cover = cover - cyl_y(x, z, K['cover_cb_d'] / 2, -R - 1, ys + K['cover_cb'], 32)
            body = body - cyl_y(x, z, K['cover_pilot_d'] / 2, K['y_cover'] - 0.01, K['y_cover'] + K['cover_pilot'], 24)
    # 덮개 아래 USB 케이블 슬롯
    sw, sh = K['usb_slot']
    zc = g['z_b'] - K['usb_below'] / 2 - 1.0
    cover = cover - box(-sw / 2 + 0.1, sw / 2 + 0.1, -R - 1, K['y_cover'] + 0.5, zc - sh / 2, zc + sh / 2)
    # 바닥 나사
    stud = mesh_to_manifold(am.stud(-K['stud_len'], 0.5, K['stud_major'], K['stud_pitch'], K['stud_clear']))
    body = body + stud
    return body, cover


def keepout(g):
    """보드·부품·SMA 플러그·안테나 목이 차지하는 영역. 본체/덮개가 여기와 겹치면 안 된다."""
    W = C['W']
    zb, zt, yp = g['z_b'], g['z_t'], g['y_pcb']
    parts = [box(-W / 2, W / 2, yp - C['pcb_t'], yp, zb, zt)]                                           # 기판
    parts.append(box(8.7 - W / 2, 24.6 - W / 2, yp - C['pcb_t'] - 3.5, yp - C['pcb_t'], zb + 20.2, zb + 42.0))   # UM982 모듈
    parts.append(box(W / 2 - 5.0, W / 2, yp - C['pcb_t'] - 6.0, yp - C['pcb_t'], zb + 16.6, zb + 24.9))        # 윗 헤더(J1 쪽)
    parts.append(box(-W / 2, -W / 2 + 5.0, yp - C['pcb_t'] - 6.0, yp - C['pcb_t'], zb + 17.0, zb + 28.0))       # 아랫 헤더
    ux = C['usb_y'] - W / 2
    parts.append(box(ux - 4.5, ux + 4.5, yp - C['pcb_t'] - C['usb_h'], yp - C['pcb_t'], zb - 0.9, zb + 6.0))   # USB-C
    bl, bw = C['sma_block']
    for sx in g['sma_x']:
        parts.append(M.cylinder(14.0, C['sma_barrel'] / 2, circular_segments=32).translate((sx, g['sma_y'], zt - 6.0)))   # SMA 몸통(밖으로 8)
        parts.append(box(sx - bw / 2, sx + bw / 2, yp - C['hmax'], yp - C['pcb_t'], zt - bl, zt))               # SMA 직각 몸체
    j1 = g['sma_x'][0]
    plug_top = zt + C['sma_out'] + K['plug_over'] + K['bend']
    parts.append(M.cylinder(plug_top - (zt + 2.0), 4.6, circular_segments=32).translate((j1, g['sma_y'], zt + 2.0)))   # 연결된 SMA 플러그 + 굽힘
    parts.append(M.cylinder(K['neck_len'], 10.2, circular_segments=64).translate((0, 0, g['z_top'] - K['neck_len'])))   # 안테나 목
    return union(parts)


def to_print_body(m, g):
    return m.rotate((180, 0, 0)).translate((0, 0, g['z_top']))      # 윗판이 베드, 나사가 위로


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    here = os.path.dirname(os.path.abspath(__file__))
    g = geom()
    body, cover = tube_parts(g)
    info('um982_tower_body', body)
    info('um982_tower_cover', cover)
    ko = keepout(g)
    print('겹침 검사: 본체-부품영역 %.3f mm³, 덮개-부품영역 %.3f mm³ (0이어야 함), 본체-덮개 %.3f mm³ (0이어야 함)' %
          ((body ^ ko).volume(), (cover ^ ko).volume(), (body ^ cover).volume()))
    print('높이: 보드 z %.1f~%.1f, 윗판 %.1f~%.1f (안테나 바닥, 원판 윗면 기준), 안테나 꼭대기 약 %.0f mm' % (g['z_b'], g['z_t'], g['z_pl'], g['z_top'], g['z_top'] + 49.1))
    print('외경 %.0f mm, 케이블 감는 구간 높이 %.1f mm (반지름 15~22)' % (2 * K['r_out'], g['z_pl'] - g['coil_z0']))
    print('권장 나사: 안테나 M3 x (귀 두께+8) 4개, 보드 M2 x 6 4개, 덮개 M3 x 8 8개')
    save_stl(to_print_body(body, g), os.path.join(here, 'um982_tower_body.stl'), 'um982_tower_body')
    save_stl(cover.translate((0, 0, -K['floor'])), os.path.join(here, 'um982_tower_cover.stl'), 'um982_tower_cover')
    print('저장:', here)


if __name__ == '__main__':
    main()
