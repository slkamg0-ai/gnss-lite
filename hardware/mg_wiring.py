# -*- coding: utf-8 -*-
"""MG 케이스 배선도(UM982 + ESP32 + 24 V→5 V 벅). 실행: python mg_wiring.py → mg_wiring.png / mg_wiring.svg
핀 배치는 firmware/gnsslite_bridge/gnsslite_bridge.ino 와 같다(UM982 UART2=COM2, ESP32 GPIO16/17, BNO085 GPIO21/22).
※ UM982 보드 헤더의 전압(3.3 V 로직인지)·+5V 핀 방향은 배선 전에 멀티미터로 확인한다(보드 매뉴얼 미확인)."""
import os
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import FancyBboxPatch, Rectangle

for f in ('Malgun Gothic', 'NanumGothic'):
    if any(f == x.name for x in font_manager.fontManager.ttflist):
        plt.rcParams['font.family'] = f
        break
plt.rcParams['axes.unicode_minus'] = False
here = os.path.dirname(os.path.abspath(__file__))

C = dict(p24='#d62828', gnd='#222222', p5='#f77f00', tx='#1d4ed8', rx='#0e9f6e', rf='#8b5e34', opt='#8a8a8a', box='#eef3e0', edge='#3b4a2a', ok='#4a7d2a')
fig, ax = plt.subplots(figsize=(21, 14))
ax.set_xlim(0, 212); ax.set_ylim(-27, 134); ax.set_aspect('equal'); ax.axis('off')


def box(x, y, w, h, title, sub='', fc=None, ec=None, ls='-', fs=11, bold=True):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle='round,pad=0.4,rounding_size=1.2', fc=fc or C['box'], ec=ec or C['edge'], lw=1.6, ls=ls))
    if title:
        ax.text(x + w / 2, y + h - 2.3, title, ha='center', va='top', fontsize=fs, fontweight='bold' if bold else 'normal', color='#1b2312')
    if sub:
        ax.text(x + w / 2, y + h - 6.2, sub, ha='center', va='top', fontsize=8.6, color='#4a5a3a', linespacing=1.35)


def wire(pts, color, lw=2.4, ls='-', label=None, lx=None, ly=None, fs=8.6):
    xs, ys = zip(*pts)
    ax.plot(xs, ys, color=color, lw=lw, ls=ls, solid_capstyle='round', zorder=3)
    if label:
        ax.text(lx if lx is not None else (xs[0] + xs[-1]) / 2, ly if ly is not None else (ys[0] + ys[-1]) / 2 + 1.6, label, ha='center', va='bottom', fontsize=fs, color=color,
                fontweight='bold', zorder=5, bbox=dict(fc='white', ec='none', pad=0.6, alpha=.85))


def dot(x, y, c='#222'):
    ax.plot([x], [y], 'o', color=c, ms=6, zorder=6)


def pin(x, y, label, side='L', c='#222', fs=8.6):
    ax.plot([x], [y], 's', color=c, ms=5.5, zorder=6)
    ax.text(x + (1.6 if side == 'L' else -1.6), y, label, ha='left' if side == 'L' else 'right', va='center', fontsize=fs, color='#1b2312', zorder=7)


ax.text(106, 131, 'MG용 UM982 수신기 배선도 — 24 V → 5 V 벅 → UM982 + ESP32(무선) / 안테나 2개', ha='center', fontsize=17, fontweight='bold', color='#1b2312')
ax.text(106, 126.6, '핀 배치는 firmware/gnsslite_bridge 와 동일 · 굵은 색 선 = 전선, 점선 = 옵션 · 주의: 표시는 배선 전 확인', ha='center', fontsize=10.5, color='#5e6a4f')

# ── 케이스 경계 ──
ax.add_patch(Rectangle((80, -4), 128, 122, fc='#fbfcf6', ec='#7d8f5a', lw=2.2, ls='--', zorder=0))
ax.text(82, 114.5, '케이스 안 (124 x 88 x 38, ASA, 자석 거치)', fontsize=10.5, color='#5a6b3a', fontweight='bold')
ax.text(2, 92.6, '굴착기 운전실 (케이스 밖)', fontsize=10.5, color='#5a6b3a', fontweight='bold')

# ── 전원 입력(케이스 밖): 퓨즈는 배터리 쪽에서 ──
NL = chr(10)
box(2, 56, 26, 34, '시거잭 소켓', '굴착기 운전실' + NL + '24 V (또는 12 V) - 실측' + NL + '시동 연동 여부 확인', fc='#fdeceb', ec='#a42020')
pin(28, 74, '중심 +', 'R', C['p24']); pin(28, 64, '바깥 -', 'R', C['gnd'])
box(34, 69.5, 22, 11, '시거잭 플러그', '퓨즈 2 A 로 교체', fs=9)
wire([(28, 74), (34, 75)], C['p24'])
wire([(56, 75), (84, 75)], C['p24'])
wire([(28, 64), (84, 64)], C['gnd'])

# ── PG7 글랜드 ──
ax.add_patch(Rectangle((78.4, 60), 3.2, 20, fc='#c9d3b3', ec='#3b4a2a', lw=1.4, zorder=2))
ax.text(80, 83.5, 'PG7 글랜드', ha='center', fontsize=9, fontweight='bold', color='#3b4a2a')
ax.text(80, 56.5, '(또는 GX12 분리 커넥터)', ha='center', fontsize=7.6, color='#3b4a2a')

# ── 케이스 안: 터미널 → 직렬 다이오드 → TVS(+/- 사이) → 벅 모듈(TPS54560) ──
box(84, 58, 8, 24, '2P', 'WAGO', fs=8.8)
wire([(92, 75), (94, 75)], C['p24']); wire([(92, 64), (112, 64)], C['gnd'])
box(94, 72, 10, 6, '', '', fc='#e8f0ff', ec='#1d4ed8')
ax.text(99, 75, 'SS54', ha='center', va='center', fontsize=9, fontweight='bold', color='#1d4ed8', zorder=6)
ax.text(99, 79.4, '역접속 방지', ha='center', fontsize=7.8, color='#1d4ed8')
wire([(104, 75), (112, 75)], C['p24'])
dot(108, 75, C['p24']); dot(108, 64, C['gnd'])
ax.add_patch(Rectangle((105.4, 66.6), 5.2, 5.6, fc='#ffe9a8', ec='#8a6d00', lw=1.6, zorder=4))
ax.text(108, 69.4, 'TVS', ha='center', va='center', fontsize=8.5, fontweight='bold', zorder=5)
wire([(108, 75), (108, 72.2)], C['p24']); wire([(108, 66.6), (108, 64)], C['gnd'])
ax.text(100, 83.2, 'TVS SMBJ33A (+/- 사이)', ha='center', fontsize=7.4, color='#8a6d00')
box(112, 52, 22, 36, 'TPS54560 벅', '5.5~60 V · 5 A', fs=9.2)
pin(112, 75, 'IN+ (x2)', 'L', C['p24']); pin(112, 69.5, 'EN 비움', 'L', C['opt']); pin(112, 64, 'GND (x3)', 'L', C['gnd'])
pin(134, 75, 'OUT+ (x3)', 'R', C['p5']); pin(134, 64, 'GND (x3)', 'R', C['gnd'])
ax.text(103, 49.0, '5V 점퍼 패드만 납땜 → 5.0 V 확인' + NL + '주의: EN 을 IN+ 에 연결 금지(최대 8 V)', ha='center', fontsize=7.8, color='#a42020', fontweight='bold', linespacing=1.35)

# ── 5 V / GND 버스 + 콘덴서 ──
wire([(134, 75), (146, 75)], C['p5'], lw=3)
wire([(134, 64), (200, 64)], C['gnd'], lw=3)
ax.text(140, 77.2, '5 V', ha='center', fontsize=9, fontweight='bold', color=C['p5'])
dot(140, 75, C['p5']); dot(140, 64, C['gnd'])
ax.add_patch(Rectangle((137.6, 67.6), 4.8, 4.2, fc='#fff2cf', ec='#8a6d00', lw=1.4, zorder=4))
ax.text(140, 69.7, 'C', ha='center', va='center', fontsize=9, fontweight='bold', zorder=5)
wire([(140, 75), (140, 71.8)], C['p5']); wire([(140, 67.6), (140, 64)], C['gnd'])
ax.text(150, 57.4, '470 µF + 100 nF (5 V 버스, ESP32 순간전류)'+chr(10)+'출력 TVS SMAJ5.0A (5 V 와 GND 사이, 과전압 시 단락 → 퓨즈 차단)', ha='left', fontsize=7.8, color='#8a6d00', linespacing=1.4)

# ── ESP32 ──
box(150, 84, 48, 34, 'ESP32 DevKit V1', '무선 브리지: BLE(NUS) / Wi-Fi\n(NTRIP·NMEA 전달)', fs=11)
pin(150, 110, 'VIN (5 V)', 'L', C['p5']); pin(150, 100, 'GND', 'L', C['gnd'])
pin(198, 113, 'GPIO16 (RX2)', 'R', C['rx']); pin(198, 107, 'GPIO17 (TX2)', 'R', C['tx'])
pin(198, 99, 'GPIO4 (PPS, 옵션)', 'R', C['opt'])
pin(198, 91, 'GPIO21 SDA / 22 SCL', 'R', C['opt'])
box(143, 105, 8, 6, '', '', fc='#e8f0ff', ec='#1d4ed8')
ax.text(147, 108, 'SS14', ha='center', va='center', fontsize=8.6, fontweight='bold', color='#1d4ed8', zorder=6)
wire([(146, 75), (146, 105)], C['p5'], lw=2.4); wire([(146, 111), (146, 110), (150, 110)], C['p5'], lw=2.4)
ax.text(142.6, 113.4, 'USB 연결 시 역류 방지', ha='right', fontsize=7.8, color='#1d4ed8')
wire([(150, 100), (147.8, 100), (147.8, 64)], C['gnd'], lw=2.4)
dot(147.8, 64, C['gnd'])

# ── UM982 보드 ──
box(150, 8, 48, 46, 'UM982 보드', 'JINYUSHI · USB-C(CH340C)\nUART 헤더 TX2/RX2 = COM2 (115200)', fs=11)
pin(150, 48, '+5V (헤더)', 'L', C['p5']); pin(150, 38, 'GND (헤더)', 'L', C['gnd'])
pin(198, 48, 'TX2', 'R', C['rx']); pin(198, 42, 'RX2', 'R', C['tx']); pin(198, 36, 'PPS (옵션)', 'R', C['opt'])
box(172, 12, 16, 5.2, '', '', fc='#fff4e0', ec='#c06a00')
ax.text(180, 14.6, 'USB-C (정비용)', ha='center', va='center', fontsize=8.4, color='#c06a00', fontweight='bold', zorder=6)
box(137, 44.5, 8, 6, '', '', fc='#e8f0ff', ec='#1d4ed8')
ax.text(141, 47.5, 'SS14', ha='center', va='center', fontsize=8.4, fontweight='bold', color='#1d4ed8', zorder=6)
wire([(140, 75), (133, 75), (133, 47.5), (137, 47.5)], C['p5'], lw=2.4)
wire([(145, 47.5), (150, 48)], C['p5'], lw=2.4)
wire([(150, 38), (147.8, 38)], C['gnd'], lw=2.4); wire([(147.8, 64), (147.8, 38)], C['gnd'], lw=2.4)
ax.text(131.4, 41, '주의: 헤더 +5V 가 입력인지\n출력인지 멀티미터로 확인', ha='right', fontsize=8.2, color='#a42020', fontweight='bold', linespacing=1.4)

# ── UART 교차 연결 ──
wire([(198, 113), (203, 113), (203, 48), (198, 48)], C['rx'], lw=2.4)
ax.text(205.4, 80, 'UM982 TX2 → ESP32 RX2', rotation=90, ha='center', va='center', fontsize=8.6, color=C['rx'], fontweight='bold')
wire([(198, 107), (200.6, 107), (200.6, 42), (198, 42)], C['tx'], lw=2.4)
ax.text(209.4, 80, 'UM982 RX2 ← ESP32 TX2', rotation=90, ha='center', va='center', fontsize=8.6, color=C['tx'], fontweight='bold')
wire([(198, 99), (196.8, 99), (196.8, 36), (198, 36)], C['opt'], lw=1.8, ls='--')
ax.text(174, 27, '공통 GND 필수\nUART 선 15 cm 이하, 꼬아서\n주의: 3.3 V 로직 확인', ha='center', fontsize=8.4, color='#a42020', linespacing=1.5)

# ── BNO085 옵션 ──
box(100, 92, 36, 18, 'BNO085 (옵션)', 'I2C 0x4A · 차체 기울기/방위\nSDA→21, SCL→22, 3V3, GND', fc='#f4f4f4', ec='#8a8a8a', ls='--', fs=9.5)
wire([(136, 100), (150, 91)], C['opt'], lw=1.6, ls='--')

# ── 안테나 / SMA ──
for x, t, tag in ((160, 'ANT1 (주)', 'J1'), (188, 'ANT2 (보조)', 'J3')):
    ax.plot([x, x], [8, 3], color=C['rf'], lw=3)
    ax.text(x + 1.6, 9.8, tag, ha='left', fontsize=9, fontweight='bold', color=C['rf'])
    ax.add_patch(Rectangle((x - 5.5, -3.6), 11, 4.4, fc='#c9d3b3', ec='#3b4a2a', lw=1.4, zorder=2))
    ax.text(x, -1.4, 'SMA 패널', ha='center', va='center', fontsize=7.8, zorder=5)
    ax.text(x + 2.4, 5.6, '점퍼 10~15 cm', ha='left', fontsize=7.6, color=C['rf'])
    ax.plot([x, x], [-3.6, -10], color=C['rf'], lw=3)
    box(x - 12.5, -22, 25, 11.6, t, 'BT-T009 (지붕)\n3.3~12 V, LNA 33 dB', fc='#f3efe6', ec=C['rf'], fs=9.2)
ax.text(169, -25.4, '안테나 간격 약 1 m 이상 · 동축(RG316/RG58) · 급전은 보드가 공급(ANTENNA POWERON)', ha='center', fontsize=8.8, color=C['rf'])

# ── 범례 / 전력 ──
ly = 122
ax.text(2, ly + 4.5, '배선 색', fontsize=10.5, fontweight='bold')
for i, (c, t) in enumerate(((C['p24'], '24 V (+) 0.75 mm²'), (C['gnd'], 'GND 0.75 mm² / 신호 GND 0.3 mm²'), (C['p5'], '5 V 0.5 mm²'), (C['rx'], 'UM982 TX → ESP32 RX'), (C['tx'], 'ESP32 TX → UM982 RX'), (C['opt'], '옵션(점선)'), (C['rf'], '동축 안테나선'))):
    ax.plot([2, 10], [ly - 1 - i * 3.7, ly - 1 - i * 3.7], color=c, lw=3); ax.text(12, ly - 1 - i * 3.7, t, va='center', fontsize=8.8)
ax.text(2, 47, '전력 예산 (5 V 기준)', fontsize=10.5, fontweight='bold')
ax.text(2, 43.4, 'UM982 + 안테나 2개  약 0.4 A\nESP32 (Wi-Fi 송신 순간)  최대 0.5 A\n합계 약 0.9 A (평균 0.5 A) = 4.5 W\n24 V 입력 전류 약 0.2 A\n→ 퓨즈 2 A, 벅 5 A (여유 5배)', fontsize=8.8, va='top', linespacing=1.5)
ax.text(2, 22, '주의: 확인 후 연결', fontsize=10.5, fontweight='bold', color='#a42020')
ax.text(2, 18.4, '1) UM982 헤더 UART 전압(3.3 V?)\n2) 헤더 +5V 핀이 입력인지\n3) USB-C 와 헤더 +5V 동시 연결 시 역류\n4) ESP32 USB 와 VIN 동시 연결 시 역류\n→ 위 SS14 직렬 다이오드로 방지', fontsize=8.6, va='top', color='#7a1010', linespacing=1.5)
fig.savefig(os.path.join(here, 'mg_wiring.png'), dpi=95, bbox_inches='tight')
fig.savefig(os.path.join(here, 'mg_wiring.svg'), bbox_inches='tight')
print('saved')
