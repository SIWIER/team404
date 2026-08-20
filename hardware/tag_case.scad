// ============================================================
//  找眼镜助手 · 防丢标签外壳 v1（演示用）
//  适配：ESP32-C3 SuperMini + TP4056(Type-C 充电板)
//        + 有源蜂鸣器 Φ9mm + 锂电池 502030 + 拨动开关 SS-12D00
//  整体尺寸：约 60 × 28 × 16 mm（不含前侧钥匙环挂耳）
//
//  用法：
//  1) 用 D:\OpenSCAD\openscad.exe 打开本文件 → F6 渲染 → F7 导出 STL
//  2) 或命令行直接出 STL：
//     D:\OpenSCAD\openscad.com -o base.stl -D 'part="base"' tag_case.scad
//     D:\OpenSCAD\openscad.com -o lid.stl  -D 'part="lid"'  tag_case.scad
//
//  打印建议：底壳开口朝上、盖子顶板朝下，均无需支撑；
//            层高 0.2mm，PLA 即可；卡扣若太紧可用砂纸轻磨或改用胶带。
// ============================================================

// 直接打开本文件 = 预览装配体；导出单个零件请用
// tag_case_base.scad（底壳）/ tag_case_lid.scad（盖子）

// ---------- 总体尺寸 ----------
L       = 60;    // 长 (x)
W       = 28;    // 宽 (y)
wall    = 2;     // 壁厚
floor_t = 2;     // 底厚
base_h  = 14;    // 底壳总高
lid_h   = 4;     // 盖子总高（顶板 2 + 裙边 2）
corner  = 3;     // 圆角半径
$fn     = 48;

// ---------- 元件安装位 ----------
bat    = [30, 20, 5];       // 电池 502030（长,宽,厚）
tp     = [25, 19, 3];       // TP4056 充电板
esp    = [22.5, 18, 1.6];   // ESP32-C3 SuperMini
esp_z  = 7.5;               // ESP32 板底面离底高度（下方放电池）
buzz_d = 9;                 // 蜂鸣器直径
usb_w  = 9.5;               // USB-C 开孔宽
// 安装坐标（x 从左到右，y 从前到后）
bat_xy   = [2, 5.7];        // 电池左下角（上面放 ESP32）
tp_xy    = [33, 5.8];       // TP4056 左下角
esp_xy   = [2.7, 4];        // ESP32 左下角（USB 朝左壁）
buzz_xy  = [45.5, 14];      // 蜂鸣器中心（挂在盖子上）

module rbox(size, rr = corner) {
  hull()
    for (x = [rr, size[0] - rr])
      for (y = [rr, size[1] - rr])
        for (z = [rr, size[2] - rr])
          translate([x, y, z]) sphere(rr);
}

// ============================================================
// 底壳
// ============================================================
module base() {
  difference() {
    rbox([L, W, base_h]);

    // 内腔
    translate([wall, wall, floor_t])
      cube([L - 2 * wall, W - 2 * wall, base_h - floor_t + 0.5]);

    // 左壁：ESP32 的 USB-C 口（上方）
    translate([-0.5, W / 2 - usb_w / 2, esp_z + 0.2])
      cube([wall + 0.6, usb_w, 3.4]);

    // 右壁：TP4056 的 USB-C 口（下方）
    translate([L - wall - 0.6, W / 2 - usb_w / 2, 2.2])
      cube([wall + 0.7, usb_w, 3.2]);

    // 前壁：拨动开关槽
    translate([20, -0.5, 4])
      cube([10, wall + 0.6, 2.8]);

    // 卡扣凹槽（前/后壁内侧，与盖子卡扣咬合）
    for (x = [14, 45]) {
      translate([x - 0.9, 1.2, 11.2]) cube([1.8, 0.8, 1.6]);   // 前壁
      translate([x - 0.9, W - 2, 11.2]) cube([1.8, 0.8, 1.6]); // 后壁
    }
  }

  // ESP32 固定柱 ×4
  for (p = [[4.2, 4.2], [4.2, 21.8], [23.7, 4.2], [23.7, 21.8]])
    translate([p[0], p[1], floor_t]) cylinder(r = 1.5, h = esp_z - floor_t);

  // 四角螺丝柱（可选加固，M2 自攻；不用螺丝也能靠卡扣合盖）
  for (p = [[3.2, 3.2], [3.2, 24.8], [56.8, 3.2], [56.8, 24.8]]) {
    difference() {
      translate([p[0], p[1], floor_t]) cylinder(r = 2.5, h = base_h - floor_t);
      translate([p[0], p[1], base_h - 7]) cylinder(r = 0.8, h = 7.5); // 引导孔
    }
  }

  // 前侧钥匙环挂耳
  difference() {
    translate([2, -5, 2]) rbox([10, 5, 10], 2);
    translate([7, -6, 7]) rotate([-90, 0, 0]) cylinder(r = 2, h = 6.5);
  }
}

// ============================================================
// 盖子
// ============================================================
module lid() {
  difference() {
    union() {
      // 顶板（与底壳内口齐平，留 0.2 装配余量）
      translate([wall + 0.2, wall + 0.2, base_h])
        cube([L - 2 * wall - 0.4, W - 2 * wall - 0.4, 2]);

      // 裙边（插入内腔）
      translate([wall + 0.2, wall + 0.2, base_h - 2])
        cube([L - 2 * wall - 0.4, W - 2 * wall - 0.4, 2]);

      // 蜂鸣器座（挂在顶板下）
      translate([buzz_xy[0], buzz_xy[1], base_h - 3.5]) {
        difference() {
          cylinder(r = buzz_d / 2 + 1.2, h = 3.5);
          translate([0, 0, -0.1]) cylinder(r = buzz_d / 2 + 0.2, h = 3.7);
        }
      }

      // 卡扣（前/后裙边外侧凸起）
      for (x = [14, 45]) {
        translate([x - 0.85, 2 - 0.7, 11.2]) cube([1.7, 0.7, 1.6]);     // 前
        translate([x - 0.85, W - 2, 11.2]) cube([1.7, 0.7, 1.6]);       // 后
      }
    }

    // 蜂鸣器出声孔（中心 1 + 四周 8）
    for (a = [0 : 45 : 315])
      translate([buzz_xy[0] + 2.2 * cos(a), buzz_xy[1] + 2.2 * sin(a), base_h - 0.1])
        cylinder(r = 0.9, h = 2.3);
    translate([buzz_xy[0], buzz_xy[1], base_h - 0.1]) cylinder(r = 0.9, h = 2.3);

    // 螺丝过孔（与底壳四角螺丝柱对应）
    for (p = [[3.2, 3.2], [3.2, 24.8], [56.8, 3.2], [56.8, 24.8]])
      translate([p[0], p[1], base_h - 0.1]) cylinder(r = 1.7, h = 3);
  }
}

// ============================================================
// 输出
// ============================================================
p = (part == undef) ? "both" : part;
if (p == "base") {
  base();
} else if (p == "lid") {
  lid();
} else {
  // 默认：预览装配
  base();
  translate([0, 0, base_h]) lid();
}
