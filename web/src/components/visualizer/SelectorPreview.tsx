import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import {
  getSelectorDefinition,
  type SelectorParamValue,
  type SelectorType,
} from "@/lib/selector-parser"
import {
  createSelectorPreviewModel,
  PLAYER_EYE_HEIGHT,
  PLAYER_HEIGHT,
  selectorOriginLabel,
  type SelectorPreviewModel,
} from "@/lib/selector-preview-geometry"

interface SelectorPreviewProps {
  type: SelectorType
  params: SelectorParamValue[]
}

interface OrbitView {
  theta: number
  phi: number
  radius: number
  target: THREE.Vector3
}

interface SceneState {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  animId: number
  selector: THREE.Object3D | null
  view: OrbitView
}

const selectorColor = 0x4ec9b0

function createEdgeMaterial(color = selectorColor): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
  })
}

function createSolidMaterial(color = selectorColor): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.14,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
}

function addSolid(group: THREE.Group, geometry: THREE.BufferGeometry, color = selectorColor) {
  group.add(new THREE.Mesh(geometry, createSolidMaterial(color)))
}

function addSurface(group: THREE.Group, geometry: THREE.BufferGeometry, color = selectorColor) {
  addSolid(group, geometry, color)
  group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 5), createEdgeMaterial(color)))
}

function addLine(group: THREE.Group, start: THREE.Vector3, end: THREE.Vector3, color = selectorColor) {
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end])
  group.add(new THREE.Line(geometry, createEdgeMaterial(color)))
}

function addPolyline(group: THREE.Group, points: THREE.Vector3[], color = selectorColor) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points)
  group.add(new THREE.Line(geometry, createEdgeMaterial(color)))
}

function addAxialCircleGuide(group: THREE.Group, radius: number, z: number, color = selectorColor) {
  if (radius <= 0) return
  const points: THREE.Vector3[] = []
  for (let index = 0; index <= 64; index++) {
    const angle = Math.PI * 2 * index / 64
    points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, z))
  }
  addPolyline(group, points, color)
}

function addAxialSideLines(group: THREE.Group, nearRadius: number, farRadius: number, nearZ: number, farZ: number, color = selectorColor) {
  for (let index = 0; index < 4; index++) {
    const angle = Math.PI * 2 * index / 4
    addLine(
      group,
      new THREE.Vector3(Math.cos(angle) * nearRadius, Math.sin(angle) * nearRadius, nearZ),
      new THREE.Vector3(Math.cos(angle) * farRadius, Math.sin(angle) * farRadius, farZ),
      color,
    )
  }
}

function addSectorOutline(group: THREE.Group, radius: number, angleDegrees: number, height: number) {
  const halfAngle = THREE.MathUtils.degToRad(angleDegrees / 2)
  const segments = Math.max(8, Math.ceil(angleDegrees / 5))
  const levels = height > 0 ? [-height / 2, height / 2] : [0]
  const edgePoints: THREE.Vector3[][] = []

  for (const y of levels) {
    const arc: THREE.Vector3[] = []
    for (let index = 0; index <= segments; index++) {
      const angle = -halfAngle + 2 * halfAngle * index / segments
      arc.push(new THREE.Vector3(Math.sin(angle) * radius, y, Math.cos(angle) * radius))
    }
    addPolyline(group, arc)
    addLine(group, new THREE.Vector3(0, y, 0), arc[0])
    addLine(group, new THREE.Vector3(0, y, 0), arc[arc.length - 1])
    edgePoints.push([arc[0], arc[arc.length - 1]])
  }

  if (edgePoints.length === 2) {
    addLine(group, edgePoints[0][0], edgePoints[1][0])
    addLine(group, edgePoints[0][1], edgePoints[1][1])
  }
}

function createSectorGeometry(radius: number, angleDegrees: number, height: number): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  const halfAngle = THREE.MathUtils.degToRad(angleDegrees / 2)
  const segments = Math.max(8, Math.ceil(angleDegrees / 5))
  shape.moveTo(0, 0)
  for (let index = 0; index <= segments; index++) {
    const angle = -halfAngle + (2 * halfAngle * index) / segments
    shape.lineTo(Math.sin(angle) * radius, Math.cos(angle) * radius)
  }
  shape.lineTo(0, 0)

  if (height <= 0) {
    const geometry = new THREE.ShapeGeometry(shape, 24)
    geometry.rotateX(Math.PI / 2)
    return geometry
  }

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 24,
  })
  geometry.rotateX(Math.PI / 2)
  geometry.translate(0, height / 2, 0)
  return geometry
}

function createAnnularGeometry(innerRadius: number, outerRadius: number, height: number): THREE.BufferGeometry | null {
  if (outerRadius <= 0) return null
  if (height <= 0) {
    const geometry = new THREE.RingGeometry(innerRadius, outerRadius, 64)
    geometry.rotateX(-Math.PI / 2)
    return geometry
  }

  const shape = new THREE.Shape()
  shape.absarc(0, 0, outerRadius, 0, Math.PI * 2, false)
  if (innerRadius > 0) {
    const hole = new THREE.Path()
    hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true)
    shape.holes.push(hole)
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 64,
  })
  geometry.rotateX(Math.PI / 2)
  geometry.translate(0, height / 2, 0)
  return geometry
}

function addCircleGuide(group: THREE.Group, radius: number, color = selectorColor) {
  if (radius <= 0) return
  const points: THREE.Vector3[] = []
  for (let index = 0; index <= 64; index++) {
    const angle = (Math.PI * 2 * index) / 64
    points.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius))
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points)
  group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 })))
}

function createSelectorMesh(model: SelectorPreviewModel): THREE.Object3D {
  const root = new THREE.Group()
  root.position.y = model.originY

  const oriented = new THREE.Group()
  oriented.rotation.y = THREE.MathUtils.degToRad(-model.yawDegrees)
  root.add(oriented)

  const content = new THREE.Group()
  content.position.set(...model.center)
  oriented.add(content)

  switch (model.kind) {
    case "sphere": {
      const geometry = new THREE.SphereGeometry(model.radius, 28, 18)
      addSurface(content, geometry, model.type === "nearest" ? 0xffd166 : selectorColor)
      break
    }
    case "box": {
      addSurface(content, new THREE.BoxGeometry(...model.size))
      break
    }
    case "sector": {
      addSolid(content, createSectorGeometry(model.radius, model.angleDegrees, model.height))
      addSectorOutline(content, model.radius, model.angleDegrees, model.height)
      break
    }
    case "cone": {
      const geometry = new THREE.ConeGeometry(model.radius, model.length, 32)
      geometry.rotateX(-Math.PI / 2)
      addSolid(content, geometry)
      addAxialCircleGuide(content, model.radius, model.length / 2)
      addAxialSideLines(content, 0, model.radius, -model.length / 2, model.length / 2)
      break
    }
    case "cylinder": {
      const geometry = new THREE.CylinderGeometry(model.radius, model.radius, model.length, 32)
      geometry.rotateX(-Math.PI / 2)
      addSolid(content, geometry)
      addAxialCircleGuide(content, model.radius, -model.length / 2)
      addAxialCircleGuide(content, model.radius, model.length / 2)
      addAxialSideLines(content, model.radius, model.radius, -model.length / 2, model.length / 2)
      break
    }
    case "frustum": {
      const geometry = new THREE.CylinderGeometry(model.nearRadius, model.farRadius, model.length, 32)
      geometry.rotateX(-Math.PI / 2)
      addSolid(content, geometry)
      addAxialCircleGuide(content, model.nearRadius, -model.length / 2)
      addAxialCircleGuide(content, model.farRadius, model.length / 2)
      addAxialSideLines(content, model.nearRadius, model.farRadius, -model.length / 2, model.length / 2)
      break
    }
    case "annular": {
      const geometry = createAnnularGeometry(model.innerRadius, model.outerRadius, model.height)
      if (geometry) addSolid(content, geometry)
      const levels = model.height > 0 ? [-model.height / 2, 0, model.height / 2] : [0]
      for (const y of levels) {
        const level = new THREE.Group()
        level.position.y = y
        addCircleGuide(level, model.outerRadius)
        addCircleGuide(level, model.innerRadius)
        content.add(level)
      }
      break
    }
    case "ring": {
      addCircleGuide(content, model.radius)
      const markerGeometry = new THREE.SphereGeometry(0.18, 10, 8)
      const markerMaterial = new THREE.MeshBasicMaterial({ color: selectorColor })
      for (let index = 0; index < model.amount; index++) {
        const angle = (Math.PI * 2 * index) / model.amount
        const marker = new THREE.Mesh(markerGeometry, markerMaterial)
        marker.position.set(Math.cos(angle) * model.radius, 0, Math.sin(angle) * model.radius)
        content.add(marker)
      }
      break
    }
    case "scatter": {
      addCircleGuide(content, model.radius)
      const markerGeometry = new THREE.SphereGeometry(0.18, 10, 8)
      const markerMaterial = new THREE.MeshBasicMaterial({ color: selectorColor })
      for (let index = 0; index < model.amount; index++) {
        const angle = index * Math.PI * (3 - Math.sqrt(5))
        const distance = model.radius * ((index + 0.5) / model.amount)
        const marker = new THREE.Mesh(markerGeometry, markerMaterial)
        marker.position.set(Math.cos(angle) * distance, 0, Math.sin(angle) * distance)
        content.add(marker)
      }
      break
    }
    case "lookat": {
      const geometry = new THREE.ConeGeometry(model.farRadius, model.distance, 32, 1, true)
      geometry.rotateX(-Math.PI / 2)
      addSolid(content, geometry)
      addAxialCircleGuide(content, model.farRadius, model.distance / 2)
      addAxialSideLines(content, 0, model.farRadius, -model.distance / 2, model.distance / 2)
      addLine(
        content,
        new THREE.Vector3(0, 0, -model.distance / 2),
        new THREE.Vector3(0, 0, model.distance / 2),
      )
      break
    }
  }

  return root
}

function disposeObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.LineSegments) {
      geometries.add(child.geometry)
      const childMaterials = Array.isArray(child.material) ? child.material : [child.material]
      for (const material of childMaterials) materials.add(material)
    }
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
}

function fitViewToSelector(selector: THREE.Object3D, view: OrbitView) {
  selector.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(selector)
  bounds.expandByPoint(new THREE.Vector3(0, 0, 0))
  bounds.expandByPoint(new THREE.Vector3(0, PLAYER_HEIGHT, 0))
  const sphere = bounds.getBoundingSphere(new THREE.Sphere())
  view.target.copy(sphere.center)
  view.radius = THREE.MathUtils.clamp(Math.max(5, sphere.radius * 2.8), 5, 160)
}

function sliderBounds(value: number, min = 0, max = 20, step = 0.5) {
  return {
    min: Math.min(min, Math.floor(value / step) * step),
    max: Math.max(max, Math.ceil(value / step) * step),
    step,
  }
}

export function SelectorPreview({ type, params }: SelectorPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<SceneState | null>(null)
  const [localParams, setLocalParams] = useState<SelectorParamValue[]>(params)
  const definition = getSelectorDefinition(type)
  const model = useMemo(() => createSelectorPreviewModel(type, localParams), [type, localParams])

  useEffect(() => { setLocalParams(params) }, [params])

  const updateSelector = useCallback(() => {
    const state = sceneRef.current
    if (!state || !model) return
    if (state.selector) {
      state.scene.remove(state.selector)
      disposeObject(state.selector)
    }
    const selector = createSelectorMesh(model)
    state.scene.add(selector)
    state.selector = selector
    fitViewToSelector(selector, state.view)
  }, [model])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0e14)

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)

    const grid = new THREE.GridHelper(80, 80, 0x35404d, 0x202832)
    scene.add(grid)
    scene.add(new THREE.AxesHelper(3))

    const playerGeometry = new THREE.CylinderGeometry(0.3, 0.3, PLAYER_HEIGHT, 10)
    const playerMaterial = new THREE.MeshBasicMaterial({ color: 0xffd700, wireframe: true })
    const player = new THREE.Mesh(playerGeometry, playerMaterial)
    player.position.y = PLAYER_HEIGHT / 2
    scene.add(player)

    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xfff176 }),
    )
    eye.position.y = PLAYER_EYE_HEIGHT
    scene.add(eye)
    scene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), eye.position, 2, 0xffd700, 0.32, 0.18))

    const view: OrbitView = {
      theta: Math.PI / 4,
      phi: Math.PI / 3,
      radius: 12,
      target: new THREE.Vector3(0, PLAYER_HEIGHT / 2, 0),
    }
    let isDragging = false
    let isPanning = false
    let previousX = 0
    let previousY = 0
    let disposed = false

    const resize = () => {
      const width = Math.max(1, container.clientWidth)
      const height = Math.max(1, container.clientHeight)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }

    const onMouseDown = (event: MouseEvent) => {
      isPanning = event.button === 1 || event.button === 2
      isDragging = !isPanning
      previousX = event.clientX
      previousY = event.clientY
    }
    const onMouseUp = () => { isDragging = false; isPanning = false }
    const onMouseMove = (event: MouseEvent) => {
      const deltaX = event.clientX - previousX
      const deltaY = event.clientY - previousY
      previousX = event.clientX
      previousY = event.clientY

      if (isPanning) {
        const speed = view.radius * 0.0018
        camera.updateMatrixWorld()
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
        view.target.addScaledVector(right, -deltaX * speed)
        view.target.addScaledVector(up, deltaY * speed)
      } else if (isDragging) {
        view.theta -= deltaX * 0.01
        view.phi = THREE.MathUtils.clamp(view.phi - deltaY * 0.01, 0.1, Math.PI - 0.1)
      }
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      view.radius = THREE.MathUtils.clamp(view.radius + event.deltaY * view.radius * 0.001, 3, 180)
    }
    const onContextMenu = (event: MouseEvent) => { event.preventDefault() }

    container.addEventListener("mousedown", onMouseDown)
    container.addEventListener("mouseup", onMouseUp)
    container.addEventListener("mouseleave", onMouseUp)
    container.addEventListener("mousemove", onMouseMove)
    container.addEventListener("wheel", onWheel, { passive: false })
    container.addEventListener("contextmenu", onContextMenu)

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)
    resize()

    const state: SceneState = { scene, camera, renderer, animId: 0, selector: null, view }
    sceneRef.current = state

    const animate = () => {
      if (disposed) return
      const horizontalRadius = view.radius * Math.sin(view.phi)
      camera.position.set(
        view.target.x + horizontalRadius * Math.cos(view.theta),
        view.target.y + view.radius * Math.cos(view.phi),
        view.target.z + horizontalRadius * Math.sin(view.theta),
      )
      camera.lookAt(view.target)
      renderer.render(scene, camera)
      state.animId = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      disposed = true
      cancelAnimationFrame(state.animId)
      resizeObserver.disconnect()
      container.removeEventListener("mousedown", onMouseDown)
      container.removeEventListener("mouseup", onMouseUp)
      container.removeEventListener("mouseleave", onMouseUp)
      container.removeEventListener("mousemove", onMouseMove)
      container.removeEventListener("wheel", onWheel)
      container.removeEventListener("contextmenu", onContextMenu)
      disposeObject(scene)
      renderer.dispose()
      renderer.forceContextLoss()
      if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement)
      sceneRef.current = null
    }
  }, [])

  useEffect(() => { updateSelector() }, [updateSelector])

  return (
    <div className="h-full min-h-0 flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3 shrink-0">
        <h3 className="text-sm font-semibold">选择器 3D 预览</h3>
        {model && (
          <span className="text-[10px] text-[#94a0b4]">
            原点：{selectorOriginLabel(model.origin)} · 前方 +Z / 右方 +X / 上方 +Y
          </span>
        )}
      </div>

      {definition && (
        <div className="flex flex-wrap gap-x-4 gap-y-2 shrink-0">
          {definition.params.map((paramDefinition, index) => {
            const value = localParams[index] ?? paramDefinition.defaultValue
            if (paramDefinition.kind === "boolean") {
              return (
                <div key={paramDefinition.key} className="flex items-center gap-2 min-w-[120px] h-8">
                  <span className="text-[11px] text-[#858585]">{paramDefinition.label}</span>
                  <Switch
                    checked={value === true}
                    onCheckedChange={(checked) => {
                      const next = [...localParams]
                      next[index] = checked
                      setLocalParams(next)
                    }}
                  />
                </div>
              )
            }

            const numericValue = typeof value === "number" ? value : Number(paramDefinition.defaultValue)
            const config = sliderBounds(
              numericValue,
              paramDefinition.min,
              paramDefinition.max,
              paramDefinition.step,
            )
            return (
              <div key={paramDefinition.key} className="space-y-1 min-w-[120px]">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-[11px] text-[#858585]">{paramDefinition.label}</label>
                  <span className="text-[11px] text-[#20a5f7] font-mono">{numericValue}</span>
                </div>
                <Slider
                  min={config.min}
                  max={config.max}
                  step={config.step}
                  value={[numericValue]}
                  onValueChange={(nextValue) => {
                    const next = [...localParams]
                    next[index] = paramDefinition.kind === "integer" ? Math.round(nextValue[0]) : nextValue[0]
                    setLocalParams(next)
                  }}
                />
              </div>
            )
          })}
        </div>
      )}

      <div ref={containerRef} className="flex-1 min-h-[220px] rounded-lg border border-border bg-black/50 overflow-hidden" />
      <div className="flex items-center justify-between gap-3 text-[10px] text-muted-foreground shrink-0">
        <span>黄色箭头表示玩家水平朝向；眼睛原点位于黄色亮点。</span>
        <span>{model?.followPitch ? "运行时跟随玩家俯仰；当前按 0° 展示。" : "按水平视角展示。"}</span>
      </div>
    </div>
  )
}
