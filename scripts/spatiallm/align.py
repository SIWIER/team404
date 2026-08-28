#!/usr/bin/env python
"""SpatialLM 预处理：点云对齐（地面转正）+ 米制缩放（按墙高）。

用法: python align.py 输入.ply [输出.ply] [目标墙高(默认2.5米)]
依赖: open3d, numpy（spatiallm 环境已带）
"""
import sys
import numpy as np
import open3d as o3d


def main():
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else "aligned.ply"
    wall_h = float(sys.argv[3]) if len(sys.argv) > 3 else 2.5

    pcd = o3d.io.read_point_cloud(src)
    print(f"原始点数: {len(pcd.points)}")
    pcd, _ = pcd.remove_statistical_outlier(nb_neighbors=20, std_ratio=2.0)
    print(f"去离群点后: {len(pcd.points)}")
    pts = np.asarray(pcd.points)

    # 1) 找最大平面（通常是地面），把法线转到 +z 方向
    plane_model, _ = pcd.segment_plane(distance_threshold=0.05, ransac_n=3, num_iterations=2000)
    n = np.array(plane_model[:3])
    n /= np.linalg.norm(n)
    if n[2] < 0:
        n = -n
    z = np.array([0.0, 0.0, 1.0])
    axis = np.cross(n, z)
    angle = np.arccos(np.clip(np.dot(n, z), -1.0, 1.0))
    if np.linalg.norm(axis) > 1e-6:
        axis /= np.linalg.norm(axis)
        K = np.array([[0, -axis[2], axis[1]],
                      [axis[2], 0, -axis[0]],
                      [-axis[1], axis[0], 0]])
        R = np.eye(3) + np.sin(angle) * K + (1 - np.cos(angle)) * (K @ K)
    else:
        R = np.eye(3)
    pts_rot = (R @ pts.T).T

    # 2) 按"墙高约 2.5 米"缩放到真实米制
    z_min, z_max = pts_rot[:, 2].min(), pts_rot[:, 2].max()
    height = z_max - z_min
    scale = wall_h / max(height, 1e-6)
    pts_final = pts_rot * scale

    out = o3d.geometry.PointCloud()
    out.points = o3d.utility.Vector3dVector(pts_final)
    out.colors = pcd.colors
    o3d.io.write_point_cloud(dst, out)
    print(f"地面法线: {n.round(3)}，点云高度 {height:.2f}m → {wall_h}m（缩放系数 {scale:.3f}）")
    print(f"已保存: {dst}")


if __name__ == "__main__":
    main()
