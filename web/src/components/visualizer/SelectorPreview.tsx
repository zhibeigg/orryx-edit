import { useRef, useEffect, useState, useCallback } from "react"
import * as THREE from "three"
import { Slider } from "@/components/ui/slider"
import type { SelectorType } from "@/lib/selector-parser"

interface SelectorPreviewProps {
  type: SelectorType
  params: number[]
  /** 原点偏移 [前方x, 上方y, 右方z] */
  offset?: [number, number, number]
}

function createSelectorMesh(type: SelectorType, params: number[]): THREE.Object3D {
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

  } else if (type === "line") {
    const [l = 5, w = 1, h = 1] = params
    const geo = new THREE.BoxGeometry(w, h, l)
    const mesh = new THREE.Mesh(geo, material)
    mesh.position.set(0, 0, l / 2)
    group.add(mesh)
    const solidMesh = new THREE.Mesh(geo.clone(), solidMaterial)
    solidMesh.position.copy(mesh.position)
    group.add(solidMesh)

  } else if (type === "cone") {
    const [r = 2, l = 5] = params
    const geo = new THREE.ConeGeometry(r, l, 24)
    geo.rotateX(Math.PI / 2)
    const mesh = new THREE.Mesh(geo, material)
    mesh.position.set(0, 0, l / 2)
    group.add(mesh)
    const solidMesh = new THREE.Mesh(geo.clone(), solidMaterial)
    solidMesh.position.copy(mesh.position)
    group.add(solidMesh)

  } else if (type === "cylinder") {
    const [r = 2, h = 3, fwd = 0, yOff = 0] = params
    const geo = new THREE.CylinderGeometry(r, r, h, 24)
    const mesh = new THREE.Mesh(geo, material)
    mesh.position.set(0, yOff, fwd)
    group.add(mesh)
    const solidMesh = new THREE.Mesh(geo.clone(), solidMaterial)
    solidMesh.position.copy(mesh.position)
    group.add(solidMesh)

  } else if (type === "frustum") {
    const [topR = 1, bottomR = 3, l = 5] = params
    const geo = new THREE.CylinderGeometry(topR, bottomR, l, 24)
    geo.rotateX(Math.PI / 2)
    const mesh = new THREE.Mesh(geo, material)
    mesh.position.set(0, 0, l / 2)
    group.add(mesh)
    const solidMesh = new THREE.Mesh(geo.clone(), solidMaterial)
    solidMesh.position.copy(mesh.position)
    group.add(solidMesh)

  } else if (type === "annular") {
    const [minR = 2, maxR = 5, h = 2] = params
    // 外圆柱 wireframe
    const outerGeo = new THREE.CylinderGeometry(maxR, maxR, h, 32)
    group.add(new THREE.Mesh(outerGeo, material))
    // 内圆柱 wireframe
    const innerGeo = new THREE.CylinderGeometry(minR, minR, h, 32)
    const innerMat = new THREE.MeshBasicMaterial({ color: 0xff6b6b, wireframe: true, transparent: true, opacity: 0.5 })
    group.add(new THREE.Mesh(innerGeo, innerMat))

  } else if (type === "ring") {
    const [r = 4, n = 8, yOff = 0] = params
    const count = Math.max(1, Math.round(n))
    const markerGeo = new THREE.SphereGeometry(0.2, 8, 8)
    const markerMat = new THREE.MeshBasicMaterial({ color: 0x4ec9b0 })
    for (let i = 0; i < count; i++) {
      const angle = (2 * Math.PI * i) / count
      const marker = new THREE.Mesh(markerGeo, markerMat)
      marker.position.set(Math.cos(angle) * r, yOff, Math.sin(angle) * r)
      group.add(marker)
    }
    // 画圆环辅助线
    const ringPoints: THREE.Vector3[] = []
    for (let i = 0; i <= 64; i++) {
      const angle = (2 * Math.PI * i) / 64
      ringPoints.push(new THREE.Vector3(Math.cos(angle) * r, yOff, Math.sin(angle) * r))
    }
    const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPoints)
    const ringLine = new THREE.Line(ringGeo, new THREE.LineBasicMaterial({ color: 0x4ec9b0, transparent: true, opacity: 0.4 }))
    group.add(ringLine)

  } else if (type === "scatter") {
    const [n = 5, r = 4] = params
    const count = Math.max(1, Math.round(n))
    const markerGeo = new THREE.SphereGeometry(0.2, 8, 8)
    const markerMat = new THREE.MeshBasicMaterial({ color: 0x4ec9b0 })
    // 使用固定种子的伪随机分布
    for (let i = 0; i < count; i++) {
      const angle = (2 * Math.PI * i) / count + (i * 1.618)
      const dist = r * Math.sqrt((i + 0.5) / count)
      const marker = new THREE.Mesh(markerGeo, markerMat)
      marker.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist)
      group.add(marker)
    }
    // 范围圆
    const circlePoints: THREE.Vector3[] = []
    for (let i = 0; i <= 64; i++) {
      const angle = (2 * Math.PI * i) / 64
      circlePoints.push(new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r))
    }
    const circleGeo = new THREE.BufferGeometry().setFromPoints(circlePoints)
    const circleLine = new THREE.Line(circleGeo, new THREE.LineDashedMaterial({ color: 0x4ec9b0, dashSize: 0.3, gapSize: 0.15 }))
    circleLine.computeLineDistances()
    group.add(circleLine)

  } else if (type === "nearest") {
    const [, r = 10] = params
    const geo = new THREE.SphereGeometry(r, 16, 12)
    const wireMat = new THREE.MeshBasicMaterial({ color: 0xffd700, wireframe: true, transparent: true, opacity: 0.3 })
    group.add(new THREE.Mesh(geo, wireMat))

  } else if (type === "lookat") {
    const [dist = 10, angle = 30] = params
    // 射线
    const rayPoints = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, dist)]
    const rayGeo = new THREE.BufferGeometry().setFromPoints(rayPoints)
    const rayLine = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({ color: 0x4ec9b0 }))
    group.add(rayLine)
    // 锥形视野
    const halfAngle = (angle / 2) * (Math.PI / 180)
    const coneR = dist * Math.tan(halfAngle)
    const coneGeo = new THREE.ConeGeometry(coneR, dist, 24, 1, true)
    coneGeo.rotateX(Math.PI / 2)
    const coneMesh = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0x4ec9b0, wireframe: true, transparent: true, opacity: 0.3 }))
    coneMesh.position.set(0, 0, dist / 2)
    group.add(coneMesh)
  }

  return group
}

const PARAM_LABELS: Partial<Record<SelectorType, string[]>> = {
  range: ["半径"],
  obb: ["长度 L", "宽度 W", "高度 H", "偏移 X", "偏移 Y"],
  sector: ["半径 R", "角度", "高度 H", "Y偏移"],
  line: ["长度 L", "宽度 W", "高度 H"],
  cone: ["底部半径 R", "长度 L"],
  cylinder: ["半径 R", "高度 H", "前偏移", "Y偏移"],
  frustum: ["上半径", "下半径", "长度 L"],
  annular: ["最小半径", "最大半径", "高度 H"],
  nearest: ["数量 N", "搜索半径 R"],
  lookat: ["距离", "角度"],
  scatter: ["数量 N", "半径 R", "前偏移"],
  ring: ["半径 R", "数量 N", "Y偏移"],
}

function getSliderConfig(type: SelectorType, paramIndex: number): { min: number; max: number; step: number } {
  if (type === "sector" && paramIndex === 1) return { min: 10, max: 360, step: 5 }
  if (type === "lookat" && paramIndex === 1) return { min: 5, max: 180, step: 5 }
  if ((type === "nearest" || type === "scatter" || type === "ring") && paramIndex === 0) return { min: 1, max: 30, step: 1 }
  return { min: 0.5, max: 20, step: 0.5 }
}

export function SelectorPreview({ type, params, offset }: SelectorPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<{
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    renderer: THREE.WebGLRenderer
    animId: number
    selector: THREE.Object3D | null
    trail: THREE.Object3D | null
  } | null>(null)
  const [localParams, setLocalParams] = useState(params)

  useEffect(() => { setLocalParams(params) }, [params])

  const updateSelector = useCallback(() => {
    if (!sceneRef.current) return
    const { scene } = sceneRef.current
    if (sceneRef.current.selector) {
      scene.remove(sceneRef.current.selector)
    }
    if (sceneRef.current.trail) {
      scene.remove(sceneRef.current.trail)
    }
    const selector = createSelectorMesh(type, localParams)

    // 应用原点偏移：flash/direct 的坐标系是 (前方=+Z, 上方=+Y, 右方=+X) 映射到 Three.js
    const ox = offset?.[2] ?? 0  // 右方 → Three.js X
    const oy = offset?.[1] ?? 0  // 上方 → Three.js Y
    const oz = offset?.[0] ?? 0  // 前方 → Three.js Z
    if (ox !== 0 || oy !== 0 || oz !== 0) {
      selector.position.set(ox, oy, oz)

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

    scene.add(selector)
    sceneRef.current.selector = selector
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

    sceneRef.current = { scene, camera, renderer, animId: 0, selector: null, trail: null }
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

  useEffect(() => { updateSelector() }, [updateSelector])

  const paramLabels = PARAM_LABELS[type] ?? []

  return (
    <div className="space-y-4 p-4">
      <h3 className="text-sm font-semibold">选择器 3D 预览</h3>

      <div className="flex flex-wrap gap-4">
        {paramLabels.map((label, i) => {
          if (i >= localParams.length) return null
          const config = getSliderConfig(type, i)
          return (
            <div key={i} className="space-y-1 min-w-[120px]">
              <div className="flex items-center justify-between">
                <label className="text-[11px] text-[#858585]">{label}</label>
                <span className="text-[11px] text-[#007acc] font-mono">{localParams[i] ?? 0}</span>
              </div>
              <Slider
                min={config.min}
                max={config.max}
                step={config.step}
                value={[localParams[i] ?? 0]}
                onValueChange={(v) => {
                  const newParams = [...localParams]
                  newParams[i] = v[0]
                  setLocalParams(newParams)
                }}
              />
            </div>
          )
        })}
      </div>

      <div ref={containerRef} className="w-full h-[400px] rounded-lg border border-border bg-black/50" />
      <p className="text-xs text-muted-foreground">鼠标拖拽旋转，滚轮缩放。黄色线框为玩家参考位置。</p>
    </div>
  )
}
