import { useRef, useEffect, useState, useCallback } from "react"
import * as THREE from "three"

interface ColliderPreviewProps {
  type: "range" | "obb" | "sector"
  params: number[]
  /** 原点偏移 [前方x, 上方y, 右方z] */
  offset?: [number, number, number]
}

function createColliderMesh(type: string, params: number[]): THREE.Object3D {
  const group = new THREE.Group()
  const material = new THREE.MeshBasicMaterial({ color: 0x4ec9b0, wireframe: true, transparent: true, opacity: 0.6 })
  const solidMaterial = new THREE.MeshBasicMaterial({ color: 0x4ec9b0, transparent: true, opacity: 0.15 })

  if (type === "range") {
    const radius = params[0] ?? 4
    const geo = new THREE.SphereGeometry(radius, 24, 16)
    group.add(new THREE.Mesh(geo, material))
    group.add(new THREE.Mesh(geo.clone(), solidMaterial))
  } else if (type === "obb") {
    const [l = 5, w = 3, h = 3, ox = 0, oy = 0] = params
    const geo = new THREE.BoxGeometry(l, h, w)
    const mesh = new THREE.Mesh(geo, material)
    mesh.position.set(l / 2 + ox, oy, 0)
    group.add(mesh)
    const solidMesh = new THREE.Mesh(geo.clone(), solidMaterial)
    solidMesh.position.copy(mesh.position)
    group.add(solidMesh)
  } else if (type === "sector") {
    const [r = 4, angle = 120, h = 2] = params
    const halfAngle = (angle / 2) * (Math.PI / 180)
    const segments = 32
    const shape = new THREE.Shape()
    shape.moveTo(0, 0)
    for (let i = 0; i <= segments; i++) {
      const a = -halfAngle + (2 * halfAngle * i) / segments
      shape.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    }
    shape.lineTo(0, 0)
    const extrudeSettings = { depth: h, bevelEnabled: false }
    const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings)
    geo.rotateX(-Math.PI / 2)
    geo.translate(0, -h / 2, 0)
    group.add(new THREE.Mesh(geo, material))
    group.add(new THREE.Mesh(geo.clone(), solidMaterial))
  }

  return group
}

export function ColliderPreview({ type, params, offset }: ColliderPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<{
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    renderer: THREE.WebGLRenderer
    animId: number
    collider: THREE.Object3D | null
    trail: THREE.Object3D | null
  } | null>(null)
  const [localParams, setLocalParams] = useState(params)

  useEffect(() => { setLocalParams(params) }, [params])

  const updateCollider = useCallback(() => {
    if (!sceneRef.current) return
    const { scene } = sceneRef.current
    if (sceneRef.current.collider) {
      scene.remove(sceneRef.current.collider)
    }
    if (sceneRef.current.trail) {
      scene.remove(sceneRef.current.trail)
    }
    const collider = createColliderMesh(type, localParams)

    // 应用原点偏移：flash/direct 的坐标系是 (前方=+Z, 上方=+Y, 右方=+X) 映射到 Three.js
    const ox = offset?.[2] ?? 0  // 右方 → Three.js X
    const oy = offset?.[1] ?? 0  // 上方 → Three.js Y
    const oz = offset?.[0] ?? 0  // 前方 → Three.js Z
    if (ox !== 0 || oy !== 0 || oz !== 0) {
      collider.position.set(ox, oy, oz)

      // 画位移轨迹虚线
      const trailGroup = new THREE.Group()
      const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(ox, oy, oz)]
      const lineGeo = new THREE.BufferGeometry().setFromPoints(points)
      const lineMat = new THREE.LineDashedMaterial({ color: 0xffd700, dashSize: 0.3, gapSize: 0.15, linewidth: 1 })
      const line = new THREE.Line(lineGeo, lineMat)
      line.computeLineDistances()
      trailGroup.add(line)

      // 偏移位置标记球
      const markerGeo = new THREE.SphereGeometry(0.15, 8, 8)
      const markerMat = new THREE.MeshBasicMaterial({ color: 0xffd700 })
      const marker = new THREE.Mesh(markerGeo, markerMat)
      marker.position.set(ox, oy, oz)
      trailGroup.add(marker)

      scene.add(trailGroup)
      sceneRef.current.trail = trailGroup
    } else {
      sceneRef.current.trail = null
    }

    scene.add(collider)
    sceneRef.current.collider = collider
  }, [type, localParams, offset])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0e14)

    const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 100)
    camera.position.set(8, 6, 8)
    camera.lookAt(0, 0, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    container.appendChild(renderer.domElement)

    // 网格地面
    const grid = new THREE.GridHelper(20, 20, 0x333333, 0x222222)
    scene.add(grid)

    // 坐标轴
    const axes = new THREE.AxesHelper(3)
    scene.add(axes)

    // 玩家参考点
    const playerGeo = new THREE.CylinderGeometry(0.3, 0.3, 1.8, 8)
    const playerMat = new THREE.MeshBasicMaterial({ color: 0xffd700, wireframe: true })
    const player = new THREE.Mesh(playerGeo, playerMat)
    player.position.y = 0.9
    scene.add(player)

    // 鼠标旋转
    let isDragging = false
    let prevX = 0, prevY = 0
    let theta = Math.PI / 4, phi = Math.PI / 4, radius = 12

    const onMouseDown = (e: MouseEvent) => { isDragging = true; prevX = e.clientX; prevY = e.clientY }
    const onMouseUp = () => { isDragging = false }
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return
      theta -= (e.clientX - prevX) * 0.01
      phi = Math.max(0.1, Math.min(Math.PI - 0.1, phi - (e.clientY - prevY) * 0.01))
      prevX = e.clientX; prevY = e.clientY
    }
    const onWheel = (e: WheelEvent) => {
      radius = Math.max(3, Math.min(30, radius + e.deltaY * 0.01))
    }

    container.addEventListener("mousedown", onMouseDown)
    container.addEventListener("mouseup", onMouseUp)
    container.addEventListener("mousemove", onMouseMove)
    container.addEventListener("wheel", onWheel)

    const animate = () => {
      camera.position.set(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta)
      )
      camera.lookAt(0, 0, 0)
      renderer.render(scene, camera)
      sceneRef.current!.animId = requestAnimationFrame(animate)
    }

    sceneRef.current = { scene, camera, renderer, animId: 0, collider: null, trail: null }
    animate()

    const onResize = () => {
      camera.aspect = container.clientWidth / container.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(container.clientWidth, container.clientHeight)
    }
    window.addEventListener("resize", onResize)

    return () => {
      cancelAnimationFrame(sceneRef.current?.animId ?? 0)
      container.removeEventListener("mousedown", onMouseDown)
      container.removeEventListener("mouseup", onMouseUp)
      container.removeEventListener("mousemove", onMouseMove)
      container.removeEventListener("wheel", onWheel)
      window.removeEventListener("resize", onResize)
      renderer.dispose()
      container.removeChild(renderer.domElement)
      sceneRef.current = null
    }
  }, [])

  useEffect(() => { updateCollider() }, [updateCollider])

  const paramLabels = type === "range"
    ? ["半径"]
    : type === "obb"
      ? ["长度 L", "宽度 W", "高度 H", "偏移 X", "偏移 Y"]
      : ["半径 R", "角度", "高度 H"]

  return (
    <div className="space-y-4 p-4">
      <h3 className="text-sm font-semibold">碰撞箱 3D 预览</h3>

      <div className="flex flex-wrap gap-3">
        {paramLabels.map((label, i) => (
          <div key={i} className="space-y-1">
            <label className="text-xs text-muted-foreground">{label}</label>
            <input
              type="range"
              min={type === "sector" && i === 1 ? 10 : 0.5}
              max={type === "sector" && i === 1 ? 360 : 20}
              step={type === "sector" && i === 1 ? 5 : 0.5}
              value={localParams[i] ?? 0}
              onChange={(e) => {
                const newParams = [...localParams]
                newParams[i] = parseFloat(e.target.value)
                setLocalParams(newParams)
              }}
              className="w-24"
            />
            <span className="text-xs text-muted-foreground ml-1">{localParams[i] ?? 0}</span>
          </div>
        ))}
      </div>

      <div ref={containerRef} className="w-full h-[400px] rounded-lg border border-border bg-black/50" />
      <p className="text-xs text-muted-foreground">鼠标拖拽旋转，滚轮缩放。黄色线框为玩家参考位置。</p>
    </div>
  )
}
