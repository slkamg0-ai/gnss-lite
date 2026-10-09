#!/usr/bin/env python3
"""UM982 보드 일체형 하우징(원판 위에 얹는 마운트) — 폴 → 원판 → [이 하우징 + 안테나 직결].
필요: pip install manifold3d numpy

구조
  - 본체: 지름 78 mm 원통. 바닥 중앙에 5/8"-11 수나사(7 mm)가 있어 원판 중앙 구멍(위쪽)에 체결된다.
          보드는 중앙에 눕고(M2 x 6 나사 4개로 받침에 직접 고정), SMA 는 앞(폴 정면), USB-C 는 뒤로 나온다.
  - 뚜껑: 윗판(두께 10)에 안테나 M3 x 4(볼트 원 Ø40, 간격 28.28)를 직접 체결하고, 가운데 구멍(Ø22)으로 안테나 목·케이블이 내려온다.
          아랫면은 반지름 35 mm 원형 오목부(깊이 12)로 안테나 케이블 보관 공간이며, 뚜껑 나사 4곳 둘레만 기둥으로 남긴다.
          앞쪽 통로가 오목부와 SMA 슬롯을 이어, 케이블이 플러그에서 위로 올라가 보관 공간으로 들어간다.
          뚜껑은 M3 x 25 나사 4개(안테나 바깥쪽)로 본체 기둥에 조인다. (어댑터·5/8" 너트는 필요 없음)
  - 출력 자세: 본체는 뒤집어(열린 쪽이 베드, 나사가 위로), 뚜껑은 바닥면이 베드.

실측/가정
  실측(사용자): 보드 치수·구멍·SMA·USB 위치는 um982_case.py 와 같음. 안테나 구멍은 도면(핸드헬드RTK.dxf)과 일치 확인.
  가정(실물 확인 필요): 원판 두께와 폴 스터드 길이(스터드가 원판 위로 튀어나오면 하우징 나사와 부딪힘),
                     안테나 목(Ø20)이 바닥 아래로 나오는 길이(윗판 10 mm 보다 길면 오목부로 돌출).
좌표: 원점 = 원판 윗면의 중심, z 위쪽. 앞(SMA 쪽) = -y, 뒤(USB 쪽) = +y.
실행: python hardware/um982_mount.py
"""
import math
import os
import sys

import manifold3d as mf
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import antenna_mount as am
import um982_case as uc

M, CS = mf.Manifold, mf.CrossSection
box, cyl_z, union, save_stl, info = uc.box, uc.cyl_z, uc.union, uc.save_stl, uc.info

K = dict(
    r_out=39.0, r_in=37.0,                 # 본체 바깥/안쪽 반지름 (원판 지름 100 보다 작게)
    floor=3.0,                             # 바닥 두께 (받침 4 mm 는 별도)
    stud_len=7.0, stud_major=25.4 * 5 / 8, stud_pitch=25.4 / 11, stud_clear=0.35,
    plate_t=10.0, store_depth=12.0, store_r=35.0,                  # 윗판 두께, 케이블 보관 오목부 깊이·반지름(본체 안쪽 반지름 37 보다 2 작게)
    neck_hole_d=22.0, ear=40.0 / math.sqrt(2) / 2, pilot_d=2.8, pilot_depth=8.0,   # 안테나 목 구멍, 안테나 M3 구멍 위치(±14.142), 셀프탭 밑구멍
    chan_w=28.0,                                                   # 오목부와 앞 SMA 슬롯을 잇는 통로 폭
    boss_xy=22.6, boss_d=8.0, boss_pilot_d=2.6, boss_pilot_depth=8.0,   # 뚜껑 나사 기둥(대각선 4곳)
    lid_hole_d=3.4, lid_cb_d=6.0, lid_cb_depth=3.0,
    usb_open=(14.0, 7.0), sma_slot_w=28.0,                          # 뒤 USB 구멍(폭, 높이: 사용자가 .scad 에서 지정한 값), 앞 SMA 슬롯 폭
)
C = dict(uc.C, floor_pad=K['floor'])


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


def dims():
    g = uc.geom(C, 'pad')
    hl, hw = C['L'] / 2, C['W'] / 2
    g['hl'], g['hw'] = hl, hw
    g['holes_c'] = [(x - hl, y - hw) for x, y in g['holes']]
    g['sma_c'] = [y - hw for y in C['sma_ys']]
    g['usb_c'] = C['usb_y'] - hw
    g['lid_t'] = K['plate_t'] + K['store_depth']
    g['top'] = g['zc'] + g['lid_t']
    return g


def body(g):
    zc, z0 = g['zc'], g['z0']
    b = cyl_z(0, 0, K['r_out'], 0, zc, 128) - cyl_z(0, 0, K['r_in'], z0, zc + 1, 128)
    posts = union(cyl_z(x, y, C['post_d'] / 2, z0 - 0.01, z0 + C['hs']) for x, y in g['holes_c'])
    bosses = union(cyl_z(sx * K['boss_xy'], sy * K['boss_xy'], K['boss_d'] / 2, z0 - 0.01, zc) for sx in (-1, 1) for sy in (-1, 1))
    b = b + posts + bosses
    b = b - union(cyl_z(x, y, C['pilot_d'] / 2, z0 + 0.4, z0 + C['hs'] + 0.01, 24) for x, y in g['holes_c'])
    b = b - union(cyl_z(sx * K['boss_xy'], sy * K['boss_xy'], K['boss_pilot_d'] / 2, zc - K['boss_pilot_depth'], zc + 0.01, 24) for sx in (-1, 1) for sy in (-1, 1))
    # 보드 좌표(회전 전): USB 쪽 = x 음수, SMA 쪽 = x 양수
    uw, uh = K['usb_open']
    zu = g['pcb_t'] + C['usb_h'] / 2
    b = b - box(-K['r_out'] - 1, -g['hl'] - 2, g['usb_c'] - uw / 2, g['usb_c'] + uw / 2, zu - uh / 2, zu + uh / 2)
    # SMA 슬롯: 플러그 몸체가 지나가도록 위로 열려 뚜껑이 덮는다
    w = K['sma_slot_w']
    zs = g['pcb_b'] + C['sma_axis']
    b = b - box(g['hl'] + 3, K['r_out'] + 1, -w / 2, w / 2, zs - 6.2, zc + 0.01)
    # 바닥 나사(원판 중앙 구멍으로)
    st = mesh_to_manifold(am.stud(-K['stud_len'], 0.5, K['stud_major'], K['stud_pitch'], K['stud_clear']))
    b = b + st
    return b.rotate((0, 0, -90))                                  # 보드 +x(SMA) → 앞(-y)


def lid(g):
    zc, top = g['zc'], g['top']
    d = cyl_z(0, 0, K['r_out'], zc, top, 128)
    pts = [(sx * K['boss_xy'], sy * K['boss_xy']) for sx in (-1, 1) for sy in (-1, 1)]
    sd = K['store_depth']
    # 케이블 보관 오목부(아래쪽에서 열림): 큰 원형, 뚜껑 나사 4곳 둘레만 기둥으로 남긴다
    store = cyl_z(0, 0, K['store_r'], zc - 0.01, zc + sd, 128) - union(cyl_z(x, y, K['boss_d'] / 2 + 0.6, zc - 1, zc + sd + 1, 32) for x, y in pts)
    d = d - store
    # 앞(-y) 통로: 오목부와 SMA 슬롯을 이어 케이블이 위로 올라오게 한다
    d = d - box(-K['chan_w'] / 2, K['chan_w'] / 2, -K['r_out'] - 1, -20.0, zc - 0.01, zc + sd)
    d = d - cyl_z(0, 0, K['neck_hole_d'] / 2, zc + sd - 0.01, top + 1, 64)              # 안테나 목·케이블이 지나는 가운데 구멍
    e = K['ear']
    d = d - union(cyl_z(sx * e, sy * e, K['pilot_d'] / 2, top - K['pilot_depth'], top + 0.01, 24) for sx in (-1, 1) for sy in (-1, 1))   # 안테나 M3 밑구멍
    d = d - union(cyl_z(x, y, K['lid_hole_d'] / 2, zc - 1, top + 1, 24) for x, y in pts)
    d = d - union(cyl_z(x, y, K['lid_cb_d'] / 2, top - K['lid_cb_depth'], top + 1, 32) for x, y in pts)
    return d


def keepout(g):
    ko = uc.board_keepout(C, g)
    return ko.translate((-g['hl'], -g['hw'], 0)).rotate((0, 0, -90))


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    here = os.path.dirname(os.path.abspath(__file__))
    g = dims()
    b = body(g)
    l = lid(g)
    info('um982_mount_body', b)
    info('um982_mount_lid', l)
    ko = keepout(g)
    print('겹침 검사: 본체-기판영역 %.3f mm³, 뚜껑-기판영역 %.3f mm³ (0이어야 함)' % ((b ^ ko).volume(), (l ^ ko).volume()))
    print('본체-뚜껑 겹침 %.3f mm³ (0이어야 함)' % ((b ^ l).volume()))
    bb = b.bounding_box()
    print('본체 바깥 지름 %.1f, 나사 포함 높이 %.1f..%.1f mm, 뚜껑 윗면 높이 %.1f mm (원판 윗면 기준)' % (2 * K['r_out'], bb[2], bb[5], g['top']))
    store = cyl_z(0, 0, K['store_r'], g['zc'], g['zc'] + K['store_depth'], 128)
    print('케이블 보관 공간(원형 오목부 R%.0f x 깊이 %.0f, 나사 기둥·통로 제외 전) 약 %.0f cm³, 안테나 바닥 높이 %.1f mm' % (K['store_r'], K['store_depth'], store.volume() / 1000, g['top']))
    print('권장 나사: 보드 M2 x 6 (4개), 뚜껑 M3 x 25 (4개), 안테나 M3 x (귀 두께+8) 4개')
    bp = b.rotate((180, 0, 0)).translate((0, 0, g['zc']))
    save_stl(bp, os.path.join(here, 'um982_mount_body.stl'), 'um982_mount_body')
    lp = l.translate((0, 0, -g['zc']))
    save_stl(lp, os.path.join(here, 'um982_mount_lid.stl'), 'um982_mount_lid')
    print('저장:', here)


if __name__ == '__main__':
    main()
