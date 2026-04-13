"use client"
import { useState, useEffect, useRef, useCallback } from "react"

interface FishProjectile {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  type: 'red' | 'blue' | 'yellow'
}

interface FishEyeState {
  x: number
  y: number
  speed: number
  spawned: boolean
  rotation: number
  lastShotTime: number
}

interface GameState {
  isPlaying: boolean
  isGameOver: boolean
  playerY: number
  playerVelocity: number
  playerX: number
  isOnGround: boolean
  cameraX: number
  isMovingLeft: boolean
  isMovingRight: boolean
  playerDirection: 'left' | 'right'
  currentIdleImage: string
  squares: Array<{ x: number; y: number; width: number; height: number }>
  isDragging: boolean
  dragStart: { x: number; y: number } | null
  dragCurrent: { x: number; y: number } | null
  jumpRequested: boolean
  score: number
  circles: Array<{ id: string; x: number; y: number; coinType: number }>
  lastCircleSpawn: number
  playerHealth: number
  gameStartTime: number
  fishEye: FishEyeState
  fishProjectiles: FishProjectile[]
}

const AdventureGame = () => {
  const [gameState, setGameState] = useState<GameState>({
    isPlaying: false,
    isGameOver: false,
    playerY: 0,
    playerVelocity: 0,
    playerX: 50,
    isOnGround: true,
    cameraX: 0,
    isMovingLeft: false,
    isMovingRight: false,
    playerDirection: 'right',
    currentIdleImage: '/idle_1.png',
    squares: [],
    isDragging: false,
    dragStart: null,
    dragCurrent: null,
    jumpRequested: false,
    score: 0,
    circles: [],
    lastCircleSpawn: 0,
    playerHealth: 100,
    gameStartTime: 0,
    fishEye: { x: -200, y: 150, speed: 0.4, spawned: false, rotation: 0, lastShotTime: 0 },
    fishProjectiles: []
  })

  const gameRef = useRef<HTMLDivElement>(null)
  const animationRef = useRef<number | undefined>(undefined)

  // Ensure character starts on ground
  useEffect(() => {
    setGameState(prev => ({ ...prev, playerY: 0, isOnGround: true, playerVelocity: 0 }))
  }, [])

  // Debug: Force reset if playerY gets too high
  /*
  useEffect(() => {
    if (Math.abs(gameState.playerY) > 160) {
      console.log('RESETTING PLAYER POSITION - playerY was:', gameState.playerY)
      setGameState(prev => ({ ...prev, playerY: 0, isOnGround: true, playerVelocity: 0 }))
    }
  }, [gameState.playerY])
  */

  // Character configuration
  const characterConfig = {
    width: 32,
    height: 32
  }

  // --- Collision helpers (AABB) ---
  type Square = { x: number; y: number; width: number; height: number }

  const rectanglesOverlap = (
    ax: number,
    ay: number,
    aw: number,
    ah: number,
    bx: number,
    by: number,
    bw: number,
    bh: number
  ) => {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by
  }

  const resolveHorizontal = (
    proposedX: number,
    playerBottomY: number,
    squares: Square[],
    moveDir: 'left' | 'right' | 'none'
  ) => {
    if (moveDir === 'none') return proposedX
    const playerWidth = characterConfig.width
    const playerHeight = characterConfig.height
    let resolvedX = proposedX

    for (const s of squares) {
      // Only consider if vertical ranges overlap
      const verticalOverlap =
        playerBottomY < s.y + s.height && playerBottomY + playerHeight > s.y
      if (!verticalOverlap) continue

      if (moveDir === 'right') {
        // If intersecting after move, clamp to left side of square
        const willOverlap = rectanglesOverlap(
          resolvedX,
          playerBottomY,
          playerWidth,
          playerHeight,
          s.x,
          s.y,
          s.width,
          s.height
        )
        if (willOverlap) {
          resolvedX = Math.min(resolvedX, s.x - playerWidth)
        }
      } else if (moveDir === 'left') {
        const willOverlap = rectanglesOverlap(
          resolvedX,
          playerBottomY,
          playerWidth,
          playerHeight,
          s.x,
          s.y,
          s.width,
          s.height
        )
        if (willOverlap) {
          resolvedX = Math.max(resolvedX, s.x + s.width)
        }
      }
    }
    return resolvedX
  }

  const resolveVertical = (
    proposedY: number, // internal Y (negative is up); bottom = -proposedY
    currentX: number,
    squares: Square[],
    verticalVelocity: number
  ) => {
    const playerWidth = characterConfig.width
    const playerHeight = characterConfig.height
    let resolvedY = proposedY
    let resolvedVelY = verticalVelocity
    let onGround = false

    const playerLeftX = currentX
    const playerRightX = currentX + playerWidth

    // First, resolve against ground (y = 0) while falling
    const proposedBottom = -resolvedY
    if (resolvedVelY > 0 && proposedBottom <= 0) {
      resolvedY = 0
      resolvedVelY = 0
      onGround = true
    }

    // Resolve against squares
    // Recompute bottom after possible ground clamp
    let bottom = -resolvedY
    let top = bottom + playerHeight

    if (resolvedVelY >= 0) {
      // Moving down: land on the highest square top we intersect
      let highestLandingY: number | null = null
      for (const s of squares) {
        const horizontalOverlap = playerLeftX < s.x + s.width && playerRightX > s.x
        if (!horizontalOverlap) continue
        const squareTop = s.y + s.height

        // Check intersection at proposed position
        const intersects = rectanglesOverlap(
          playerLeftX,
          bottom,
          playerWidth,
          playerHeight,
          s.x,
          s.y,
          s.width,
          s.height
        )
        if (!intersects) continue

        // Candidate landing: set player bottom to squareTop
        if (highestLandingY === null || squareTop > highestLandingY) {
          highestLandingY = squareTop
        }
      }
      if (highestLandingY !== null) {
        bottom = highestLandingY
        resolvedY = -bottom
        resolvedVelY = 0
        onGround = true
      }
    } else {
      // Moving up: hit head on the lowest square bottom we intersect
      let lowestCeilingY: number | null = null
      for (const s of squares) {
        const horizontalOverlap = playerLeftX < s.x + s.width && playerRightX > s.x
        if (!horizontalOverlap) continue
        const squareBottom = s.y

        const intersects = rectanglesOverlap(
          playerLeftX,
          bottom,
          playerWidth,
          playerHeight,
          s.x,
          s.y,
          s.width,
          s.height
        )
        if (!intersects) continue

        if (lowestCeilingY === null || squareBottom < lowestCeilingY) {
          lowestCeilingY = squareBottom
        }
      }
      if (lowestCeilingY !== null) {
        // Set player top to squareBottom
        const newTop = lowestCeilingY
        bottom = newTop - playerHeight
        resolvedY = -bottom
        resolvedVelY = 0
        // onGround remains false when hitting head
      }
    }

    return { y: resolvedY, vy: resolvedVelY, onGround }
  }

  const startGame = () => {
    const idleImages = ['/idle_1.png', '/idle_2.png', '/idle_3.png']
    setGameState(prev => ({
      ...prev,
      isPlaying: true,
      isGameOver: false,
      playerY: 0,
      playerVelocity: 0,
      playerX: 50,
      isOnGround: true,
      cameraX: 0,
      isMovingLeft: false,
      isMovingRight: false,
      playerDirection: 'right',
      currentIdleImage: idleImages[Math.floor(Math.random() * idleImages.length)],
      jumpRequested: false,
      score: 0,
      circles: [],
      lastCircleSpawn: 0,
      playerHealth: 100,
      gameStartTime: Date.now(),
      fishEye: { x: -200, y: 150, speed: 0.4, spawned: false, rotation: 0, lastShotTime: 0 },
      fishProjectiles: []
    }))
  }

  const jump = useCallback(() => {
    if (!gameState.isPlaying || gameState.isGameOver) return
    // Allow jump if on ground or very close to it
    if (!gameState.isOnGround && gameState.playerY < -2) return
    
    setGameState(prev => ({
      ...prev,
      playerVelocity: -6,
      isOnGround: false
    }))
  }, [gameState.isPlaying, gameState.isGameOver, gameState.isOnGround, gameState.playerY])


  // Game loop
  useEffect(() => {
    if (!gameState.isPlaying) return

      const gameLoop = () => {
        setGameState(prev => {
          if (prev.isGameOver) return prev
          
          try {

        // Integrate physics
        let newPlayerVelocity = prev.playerVelocity + 0.3 // gravity
        let proposedY = prev.playerY + newPlayerVelocity

        // Horizontal movement intent
        let moveDir: 'left' | 'right' | 'none' = 'none'
        if (prev.isMovingLeft) moveDir = 'left'
        else if (prev.isMovingRight) moveDir = 'right'

        let newPlayerDirection = prev.playerDirection
        if (moveDir === 'left') newPlayerDirection = 'left'
        else if (moveDir === 'right') newPlayerDirection = 'right'

        // Pick idle image when movement begins (simple heuristic)
        let newCurrentIdleImage = prev.currentIdleImage
        if (moveDir !== 'none' && !(prev.isMovingLeft || prev.isMovingRight)) {
          const idleImages = ['/idle_1.png', '/idle_2.png', '/idle_3.png']
          newCurrentIdleImage = idleImages[Math.floor(Math.random() * idleImages.length)]
        }

        // Horizontal resolve first (use previous vertical position for robustness)
        const intendedX = moveDir === 'left' ? prev.playerX - 2 : moveDir === 'right' ? prev.playerX + 2 : prev.playerX
        const currentBottom = -prev.playerY
        const newPlayerX = resolveHorizontal(intendedX, currentBottom, prev.squares, moveDir)

        // Vertical resolve against ground and squares using the horizontally-resolved X
        const verticalResolution = resolveVertical(proposedY, newPlayerX, prev.squares, newPlayerVelocity)
        const newPlayerY = verticalResolution.y
        newPlayerVelocity = verticalResolution.vy
        const newIsOnGround = verticalResolution.onGround

        // Update camera to follow player
        const newCameraX = Math.max(0, newPlayerX - 100)

        // Circle spawning (rarely, only when traversing)
        let newCircles = [...prev.circles]
        let newScore = prev.score
        const currentTime = Date.now()
        
        // Only spawn circles when player is moving horizontally
        const isPlayerMoving = moveDir !== 'none'
        
        // Spawn new coin every 8-15 seconds, only when moving
        if (isPlayerMoving && currentTime - prev.lastCircleSpawn > 8000 + Math.random() * 7000) {
          const coinType = Math.floor(Math.random() * 4) + 1 // 1, 2, 3, or 4
          const newCircle = {
            id: `coin-${currentTime}-${Math.random()}`,
            x: newPlayerX + 300 + Math.random() * 200, // Spawn further ahead of player
            y: Math.random() * 200, // Any Y level
            coinType: coinType
          }
          newCircles.push(newCircle)
        }

        // Check circle collisions
        const playerLeftX = newPlayerX
        const playerRightX = newPlayerX + characterConfig.width
        const playerTopY = -newPlayerY + characterConfig.height
        const playerBottomY = -newPlayerY

        newCircles = newCircles.filter(circle => {
          const circleLeftX = circle.x - 8 // Circle radius
          const circleRightX = circle.x + 8
          const circleTopY = circle.y + 8
          const circleBottomY = circle.y - 8

          // Check if player touches circle
          const collides = rectanglesOverlap(
            playerLeftX, playerBottomY, characterConfig.width, characterConfig.height,
            circleLeftX, circleBottomY, 16, 16
          )

          if (collides) {
            // Different score values based on coin type
            const coinScores = { 1: 1, 2: 5, 3: 10, 4: 15 }
            newScore += coinScores[circle.coinType as keyof typeof coinScores] || 1
            return false // Remove circle
          }
          return true // Keep circle
        })

        // --- Fish Eye AI ---
        let newFishEye = { ...prev.fishEye }
        let newFishProjectiles = [...prev.fishProjectiles]
        let newPlayerHealth = prev.playerHealth
        let newIsGameOver: boolean = prev.isGameOver

        const timeSinceStart = currentTime - prev.gameStartTime
        const fishSpawnDelay = 6000

        if (!newFishEye.spawned && timeSinceStart >= fishSpawnDelay) {
          newFishEye.spawned = true
          newFishEye.x = newPlayerX + 400
          newFishEye.y = 180
          newFishEye.speed = 0.4
          newFishEye.lastShotTime = currentTime
        }

        if (newFishEye.spawned && !newIsGameOver) {
          const elapsedSinceSpawn = (timeSinceStart - fishSpawnDelay) / 1000
          newFishEye.speed = Math.min(0.4 + elapsedSinceSpawn * 0.012, 1.8)

          const playerCenterX = newPlayerX + characterConfig.width / 2
          const playerCenterY = -newPlayerY + characterConfig.height / 2
          const fishCenterX = newFishEye.x
          const fishCenterY = newFishEye.y

          const dx = playerCenterX - fishCenterX
          const dy = playerCenterY - fishCenterY
          const dist = Math.sqrt(dx * dx + dy * dy)

          // Off-screen speed boost when fish is very far away
          let effectiveSpeed = newFishEye.speed
          if (dist > 300) {
            effectiveSpeed = newFishEye.speed * (1 + (dist - 300) / 200)
          }

          if (dist > 1) {
            newFishEye.x += (dx / dist) * effectiveSpeed
            newFishEye.y += (dy / dist) * effectiveSpeed
          }

          newFishEye.rotation = Math.atan2(dy, dx) * (180 / Math.PI)

          // Shooting: every ~2.5s, pick a projectile type with weighted odds
          const shotCooldown = 2500 + Math.random() * 100
          if (currentTime - newFishEye.lastShotTime > shotCooldown && dist > 60) {
            const bulletSpeed = 2.5
            const bvx = (dx / dist) * bulletSpeed
            const bvy = (dy / dist) * bulletSpeed

            const roll = Math.random()
            let projType: 'red' | 'blue' | 'yellow' = 'red'
            if (roll > 0.92) projType = 'blue'
            else if (roll > 0.82) projType = 'yellow'

            newFishProjectiles.push({
              id: `fp-${currentTime}-${Math.random()}`,
              x: newFishEye.x,
              y: newFishEye.y,
              vx: bvx,
              vy: bvy,
              type: projType
            })
            newFishEye.lastShotTime = currentTime
          }

          // Check fish-to-player collision (instant kill)
          const fishSize = 36
          const fishLeft = newFishEye.x - fishSize / 2
          const fishBottom = newFishEye.y - fishSize / 2
          const touchesPlayer = rectanglesOverlap(
            playerLeftX, playerBottomY, characterConfig.width, characterConfig.height,
            fishLeft, fishBottom, fishSize, fishSize
          )
          if (touchesPlayer) {
            newPlayerHealth = 0
            newIsGameOver = true
          }
        }

        // Update fish projectiles (with obstacle interaction per type)
        let newSquares = [...prev.squares]
        newFishProjectiles = newFishProjectiles.filter(p => {
          p.x += p.vx
          p.y += p.vy

          const pdx = p.x - newPlayerX
          const pdy = p.y - (-newPlayerY)
          if (pdx * pdx + pdy * pdy > 800 * 800) return false

          const pSize = 6
          const pLeft = p.x - pSize / 2
          const pBottom = p.y - pSize / 2

          // Red: blocked by player-drawn squares
          if (p.type === 'red') {
            for (const s of newSquares) {
              if (rectanglesOverlap(pLeft, pBottom, pSize, pSize, s.x, s.y, s.width, s.height)) {
                return false
              }
            }
          }

          // Yellow: destroys squares it passes through
          if (p.type === 'yellow') {
            newSquares = newSquares.filter(s => {
              return !rectanglesOverlap(pLeft, pBottom, pSize, pSize, s.x, s.y, s.width, s.height)
            })
          }

          // Blue: passes through everything (no obstacle check)

          const hitsPlayer = rectanglesOverlap(
            playerLeftX, playerBottomY, characterConfig.width, characterConfig.height,
            pLeft, pBottom, pSize, pSize
          )
          if (hitsPlayer) {
            const dmg = p.type === 'red' ? 12 : 6
            newPlayerHealth = Math.max(0, newPlayerHealth - dmg)
            if (newPlayerHealth <= 0) {
              newIsGameOver = true
            }
            return false
          }
          return true
        })

        return {
          ...prev,
          playerY: newPlayerY,
          playerVelocity: newPlayerVelocity,
          playerX: newPlayerX,
          playerDirection: newPlayerDirection,
          currentIdleImage: newCurrentIdleImage,
          isOnGround: newIsOnGround,
          cameraX: newCameraX,
          circles: newCircles,
          score: newScore,
          lastCircleSpawn: newCircles.length > prev.circles.length ? currentTime : prev.lastCircleSpawn,
          playerHealth: newPlayerHealth,
          isGameOver: newIsGameOver,
          fishEye: newFishEye,
          fishProjectiles: newFishProjectiles,
          squares: newSquares
        }
          } catch (error) {
            console.error('Game loop error:', error)
            return prev
          }
        })

      animationRef.current = requestAnimationFrame(gameLoop)
    }

    animationRef.current = requestAnimationFrame(gameLoop)

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [gameState.isPlaying, gameState.isGameOver])

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Enter' && !gameState.isPlaying) {
        e.preventDefault()
        startGame()
      } else if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault()
        console.log('JUMP KEY PRESSED:', e.code)
        jump()
      } else if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
        e.preventDefault()
        setGameState(prev => ({ ...prev, isMovingLeft: true }))
      } else if (e.code === 'KeyD' || e.code === 'ArrowRight') {
        e.preventDefault()
        setGameState(prev => ({ ...prev, isMovingRight: true }))
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
        e.preventDefault()
        setGameState(prev => ({ ...prev, isMovingLeft: false }))
      } else if (e.code === 'KeyD' || e.code === 'ArrowRight') {
        e.preventDefault()
        setGameState(prev => ({ ...prev, isMovingRight: false }))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [jump, gameState.isPlaying])

  // Mouse event handlers for drawing squares
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!gameState.isPlaying) return
    e.preventDefault()
    
    const rect = gameRef.current?.getBoundingClientRect()
    if (!rect) return
    
    const x = e.clientX - rect.left + gameState.cameraX
    const y = rect.height - (e.clientY - rect.top) // Flip Y coordinate
    
    setGameState(prev => ({
      ...prev,
      isDragging: true,
      dragStart: { x, y },
      dragCurrent: { x, y }
      // Don't stop movement - allow drawing while moving
    }))
  }

  // Touch event handlers for drawing squares (mobile)
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!gameState.isPlaying) return
    if (e.touches.length === 0) return
    e.preventDefault()

    const rect = gameRef.current?.getBoundingClientRect()
    if (!rect) return

    const touch = e.touches[0]
    const x = touch.clientX - rect.left + gameState.cameraX
    const y = rect.height - (touch.clientY - rect.top)

    setGameState(prev => ({
      ...prev,
      isDragging: true,
      dragStart: { x, y },
      dragCurrent: { x, y }
      // Don't stop movement - allow drawing while moving
    }))
  }

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!gameState.isDragging || !gameState.isPlaying) return
    if (e.touches.length === 0) return
    e.preventDefault()

    const rect = gameRef.current?.getBoundingClientRect()
    if (!rect) return

    const touch = e.touches[0]
    const x = touch.clientX - rect.left + gameState.cameraX
    const y = rect.height - (touch.clientY - rect.top)

    setGameState(prev => ({
      ...prev,
      dragCurrent: { x, y }
    }))
  }

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (!gameState.isDragging || !gameState.dragStart || !gameState.dragCurrent || !gameState.isPlaying) {
      setGameState(prev => ({
        ...prev,
        isDragging: false,
        dragStart: null,
        dragCurrent: null
      }))
      return
    }

    const startX = Math.min(gameState.dragStart.x, gameState.dragCurrent.x)
    const startY = Math.min(gameState.dragStart.y, gameState.dragCurrent.y)
    const width = Math.abs(gameState.dragCurrent.x - gameState.dragStart.x)
    const height = Math.abs(gameState.dragCurrent.y - gameState.dragStart.y)

    if (width > 4 && height > 4) {
      setGameState(prev => ({
        ...prev,
        squares: [...prev.squares, { x: startX, y: startY, width, height }],
        isDragging: false,
        dragStart: null,
        dragCurrent: null
      }))
    } else {
      setGameState(prev => ({
        ...prev,
        isDragging: false,
        dragStart: null,
        dragCurrent: null
      }))
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!gameState.isDragging || !gameState.isPlaying) return
    e.preventDefault()
    
    const rect = gameRef.current?.getBoundingClientRect()
    if (!rect) return
    
    const x = e.clientX - rect.left + gameState.cameraX
    const y = rect.height - (e.clientY - rect.top) // Flip Y coordinate
    
    setGameState(prev => ({
      ...prev,
      dragCurrent: { x, y }
    }))
  }

  const handleMouseUp = (e?: React.MouseEvent<HTMLDivElement>) => {
    if (e) e.preventDefault()
    if (!gameState.isDragging || !gameState.dragStart || !gameState.dragCurrent || !gameState.isPlaying) {
      setGameState(prev => ({
        ...prev,
        isDragging: false,
        dragStart: null,
        dragCurrent: null
      }))
      return
    }
    
    const startX = Math.min(gameState.dragStart.x, gameState.dragCurrent.x)
    const startY = Math.min(gameState.dragStart.y, gameState.dragCurrent.y)
    const width = Math.abs(gameState.dragCurrent.x - gameState.dragStart.x)
    const height = Math.abs(gameState.dragCurrent.y - gameState.dragStart.y)
    
    // Only create square if it has minimum size
    if (width > 4 && height > 4) {
      setGameState(prev => ({
        ...prev,
        squares: [...prev.squares, { x: startX, y: startY, width, height }],
        isDragging: false,
        dragStart: null,
        dragCurrent: null
      }))
    } else {
      setGameState(prev => ({
        ...prev,
        isDragging: false,
        dragStart: null,
        dragCurrent: null
      }))
    }
  }


  const renderSquare = (square: { x: number; y: number; width: number; height: number }, index: number) => {
    return (
      <div
        key={`square-${index}`}
        className="absolute bg-white border border-gray-400"
        style={{
          left: `${square.x - gameState.cameraX}px`,
          bottom: `${square.y}px`,
          width: `${square.width}px`,
          height: `${square.height}px`,
          zIndex: 5
        }}
      />
    )
  }

  const renderDragPreview = () => {
    if (!gameState.isDragging || !gameState.dragStart || !gameState.dragCurrent) return null
    
    const startX = Math.min(gameState.dragStart.x, gameState.dragCurrent.x)
    const startY = Math.min(gameState.dragStart.y, gameState.dragCurrent.y)
    const width = Math.abs(gameState.dragCurrent.x - gameState.dragStart.x)
    const height = Math.abs(gameState.dragCurrent.y - gameState.dragStart.y)
    
    return (
      <div
        className="absolute bg-white bg-opacity-50 border-2 border-white border-dashed"
        style={{
          left: `${startX - gameState.cameraX}px`,
          bottom: `${startY}px`,
          width: `${width}px`,
          height: `${height}px`,
          zIndex: 15,
          pointerEvents: 'none'
        }}
      />
    )
  }

    const renderPlayer = () => {
    const isMoving = gameState.isMovingLeft || gameState.isMovingRight
    
    return (
      <div
        className="absolute z-10"
        style={{
          left: `${gameState.playerX - gameState.cameraX}px`,
          bottom: `${Math.max(0, -gameState.playerY)}px`,
          width: `${characterConfig.width}px`,
          height: `${characterConfig.height}px`,
          transform: gameState.playerDirection === 'left' ? 'scaleX(-1)' : 'scaleX(1)',
          imageRendering: 'pixelated'
        }}
      >
        {isMoving ? (
          <img
            src="/little_gif_guy.gif"
            alt="Character"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain'
            }}
          />
        ) : (
          <img
            src={gameState.currentIdleImage}
            alt="Character"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain'
            }}
          />
        )}
      </div>
    )
  }

  const renderFishEye = () => {
    if (!gameState.fishEye.spawned) return null
    const fishSize = 36
    return (
      <div
        className="absolute"
        style={{
          left: `${gameState.fishEye.x - gameState.cameraX - fishSize / 2}px`,
          bottom: `${gameState.fishEye.y - fishSize / 2}px`,
          width: `${fishSize}px`,
          height: `${fishSize}px`,
          zIndex: 20,
          imageRendering: 'pixelated',
          transform: `rotate(${-gameState.fishEye.rotation}deg)`,
          filter: 'drop-shadow(0 0 6px rgba(255,0,0,0.5))',
          transition: 'filter 0.3s'
        }}
      >
        <img
          src="/evil_fish_eye.png"
          alt="Evil Fish Eye"
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </div>
    )
  }

  const renderFishProjectile = (proj: FishProjectile) => {
    const pSize = proj.type === 'red' ? 6 : 8
    const colorMap = {
      red:    { bg: '#ff2222', shadow: '0 0 4px #ff0000, 0 0 8px #ff000088' },
      blue:   { bg: '#4488ff', shadow: '0 0 6px #2266ff, 0 0 12px #2266ff88' },
      yellow: { bg: '#ffcc00', shadow: '0 0 6px #ffaa00, 0 0 12px #ffaa0088' }
    }
    const c = colorMap[proj.type]
    return (
      <div
        key={proj.id}
        className="absolute"
        style={{
          left: `${proj.x - gameState.cameraX - pSize / 2}px`,
          bottom: `${proj.y - pSize / 2}px`,
          width: `${pSize}px`,
          height: `${pSize}px`,
          zIndex: 19,
          backgroundColor: c.bg,
          boxShadow: c.shadow,
          imageRendering: 'pixelated',
          borderRadius: proj.type === 'blue' ? '50%' : '1px'
        }}
      />
    )
  }

  const renderHealthBar = () => {
    const healthPercent = Math.max(0, gameState.playerHealth)
    const barColor = healthPercent > 50 ? '#22c55e' : healthPercent > 25 ? '#eab308' : '#ef4444'
    return (
      <div className="absolute top-2 left-2 z-30 flex items-center gap-2">
        <span className="text-white text-xs font-mono" style={{ textShadow: '0 0 4px black' }}>HP</span>
        <div className="w-24 h-3 bg-gray-800 border border-gray-600 rounded-sm overflow-hidden">
          <div
            className="h-full transition-all duration-200"
            style={{
              width: `${healthPercent}%`,
              backgroundColor: barColor
            }}
          />
        </div>
      </div>
    )
  }

  const renderCircle = (circle: { id: string; x: number; y: number; coinType: number }) => {
    // Map coin types to actual filenames
    const coinImages = {
      1: '/coin.png',
      2: '/coin2.png', 
      3: '/coin3.png',
      4: '/coin4.png'
    }
    
    return (
      <div
        key={circle.id}
        className="absolute z-5"
        style={{
          left: `${circle.x - gameState.cameraX - 8}px`,
          bottom: `${circle.y - 8}px`,
          width: '16px',
          height: '16px',
          imageRendering: 'pixelated'
        }}
      >
        <img
          src={coinImages[circle.coinType as keyof typeof coinImages] || '/coin.png'}
          alt={`Coin ${circle.coinType}`}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain'
          }}
          onError={(e) => {
            // Fallback to a colored circle if image fails to load
            const target = e.target as HTMLImageElement
            target.style.display = 'none'
            const parent = target.parentElement
            if (parent) {
              parent.style.backgroundColor = '#feca57'
              parent.style.borderRadius = '50%'
              parent.style.border = '1px solid #ffd700'
            }
          }}
        />
      </div>
    )
  }

  return (
    <div className="mt-6">
      {!gameState.isPlaying ? (
        <div className="text-left" onClick={startGame} onTouchStart={(e) => { e.preventDefault(); startGame() }}>
          <p className="text-gray-300 mb-2">
            Tap or press enter to start your adventure
          </p>
          <p className="text-gray-300 mb-2 text-sm">
            Click and drag to create collidable squares
          </p>
        </div>
      ) : (
        <div className="relative">
          {gameState.isGameOver && (
            <div className="absolute inset-0 bg-black bg-opacity-90 flex items-center justify-center z-10">
              <div className="text-center">
                <div className="text-white text-lg mb-4">Game Over!</div>
                <div className="text-white text-sm mb-4">Final Score: {gameState.score}</div>
                <button
                  onClick={startGame}
                  className="text-gray-400 hover:text-white transition-colors cursor-pointer"
                >
                  Press ENTER to play again
                </button>
              </div>
            </div>
          )}
          
          <div 
            ref={gameRef}
            className={`relative h-64 sm:h-72 md:h-80 lg:h-92 overflow-hidden ${gameState.isPlaying ? 'cursor-crosshair' : ''}`}
            style={{ width: '100%', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
            onMouseDown={gameState.isPlaying ? handleMouseDown : undefined}
            onMouseMove={gameState.isPlaying ? handleMouseMove : undefined}
            onMouseUp={gameState.isPlaying ? handleMouseUp : undefined}
            onMouseLeave={gameState.isPlaying ? handleMouseUp : undefined}
            onTouchStart={gameState.isPlaying ? handleTouchStart : undefined}
            onTouchMove={gameState.isPlaying ? handleTouchMove : undefined}
            onTouchEnd={gameState.isPlaying ? handleTouchEnd : undefined}
            onTouchCancel={gameState.isPlaying ? handleTouchEnd : undefined}
          >
            {/* Health Bar */}
            {renderHealthBar()}

            {/* Squares */}
            {gameState.squares.map(renderSquare)}
            
            {/* Coins */}
            {gameState.circles.map(renderCircle)}
            
            {/* Drag Preview */}
            {renderDragPreview()}
            
            {/* Player Character */}
            {renderPlayer()}

            {/* Fish Eye Enemy */}
            {renderFishEye()}

            {/* Fish Projectiles */}
            {gameState.fishProjectiles.map(renderFishProjectile)}

            {/* Ground line */}
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-600"></div>
          </div>

          {/* Score display */}
          <div className="mt-3 text-left">
            <div className="bg-black bg-opacity-50 text-white px-3 py-1 rounded text-sm font-mono inline-block">
              Score: {gameState.score}
            </div>
          </div>

          {/* On-screen controls for mobile (visible only on small screens) */}
          <div className="mt-3 md:hidden flex items-center justify-between select-none" style={{ touchAction: 'none' }}>
            <div className="flex gap-2">
              <button
                className="px-4 py-3 rounded-md bg-black text-white active:bg-gray-800 select-none"
                style={{ userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
                onTouchStart={(e) => { e.preventDefault(); setGameState(prev => ({ ...prev, isMovingLeft: true })) }}
                onTouchEnd={(e) => { e.preventDefault(); setGameState(prev => ({ ...prev, isMovingLeft: false })) }}
                onTouchCancel={(e) => { e.preventDefault(); setGameState(prev => ({ ...prev, isMovingLeft: false })) }}
                onMouseDown={() => setGameState(prev => ({ ...prev, isMovingLeft: true }))}
                onMouseUp={() => setGameState(prev => ({ ...prev, isMovingLeft: false }))}
                onMouseLeave={() => setGameState(prev => ({ ...prev, isMovingLeft: false }))}
              >
                ◀︎
              </button>
              <button
                className="px-4 py-3 rounded-md bg-black text-white active:bg-gray-800 select-none"
                style={{ userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
                onTouchStart={(e) => { e.preventDefault(); setGameState(prev => ({ ...prev, isMovingRight: true })) }}
                onTouchEnd={(e) => { e.preventDefault(); setGameState(prev => ({ ...prev, isMovingRight: false })) }}
                onTouchCancel={(e) => { e.preventDefault(); setGameState(prev => ({ ...prev, isMovingRight: false })) }}
                onMouseDown={() => setGameState(prev => ({ ...prev, isMovingRight: true }))}
                onMouseUp={() => setGameState(prev => ({ ...prev, isMovingRight: false }))}
                onMouseLeave={() => setGameState(prev => ({ ...prev, isMovingRight: false }))}
              >
                ▶︎
              </button>
            </div>
            <button
              className="px-5 py-3 rounded-md bg-black bg-opacity-50 border border-white text-white active:bg-opacity-70 select-none"
              style={{ fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif', fontWeight: 100, userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
              onTouchStart={(e) => { e.preventDefault(); jump() }}
              onMouseDown={() => jump()}
            >
              Jump
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdventureGame

