const PLAYER_STATUS = {
  IDLE: 'idle',
  LOADING: 'loading',
  PLAYING: 'playing',
  PAUSED: 'paused',
  ENDED: 'ended',
  ERROR: 'error',
}

const GIFT_SIZE = {
  BIG: 'big',
  SMALL: 'small',
}

export class GiftAnimationPlayer {
  constructor(options = {}) {
    this.container = options.container ? resolveContainer(options.container) : createDefaultContainer()
    this.containers = {
      [GIFT_SIZE.BIG]: resolveOptionalContainer(options.containers?.big || options.bigContainer) || this.container,
      [GIFT_SIZE.SMALL]: resolveOptionalContainer(options.containers?.small || options.smallContainer) || this.container,
    }
    this.width = options.width || 200
    this.height = options.height || 200
    this.smallWidth = options.smallWidth || 260
    this.smallHeight = options.smallHeight || 56
    this.maxConcurrent = normalizeMaxConcurrent(options)
    this.autoPlay = options.autoPlay ?? true
    this.queues = {
      [GIFT_SIZE.BIG]: [],
      [GIFT_SIZE.SMALL]: [],
    }
    this.active = {
      [GIFT_SIZE.BIG]: new Map(),
      [GIFT_SIZE.SMALL]: new Map(),
    }
    this.events = new Map()
    this.processing = {
      [GIFT_SIZE.BIG]: false,
      [GIFT_SIZE.SMALL]: false,
    }

    setupContainer(this.container, options)
  }

  on(eventName, handler) {
    if (!this.events.has(eventName))
      this.events.set(eventName, new Set())

    this.events.get(eventName).add(handler)

    return () => this.off(eventName, handler)
  }

  off(eventName, handler) {
    this.events.get(eventName)?.delete(handler)
  }

  play(url, options = {}) {
    return this.enqueue(url, options)
  }

  enqueue(url, options = {}) {
    const gift = normalizeGift(url, options)
    this.queues[gift.size].push(gift)
    this.emit('queued', gift)

    if (this.autoPlay)
      this.processQueue(gift.size)

    return gift.id
  }

  playMany(urls = [], options = {}) {
    const ids = urls.map(url => this.enqueue(url, options))

    if (this.autoPlay)
      this.processQueue()

    return ids
  }

  async processQueue(size) {
    if (!size) {
      await Promise.all([
        this.processQueue(GIFT_SIZE.BIG),
        this.processQueue(GIFT_SIZE.SMALL),
      ])
      return
    }

    if (this.processing[size])
      return

    this.processing[size] = true

    try {
      while (this.queues[size].length > 0 && this.active[size].size < this.maxConcurrent[size]) {
        const gift = this.queues[size].shift()
        this.startGift(gift)
      }
    }
    finally {
      this.processing[size] = false
    }
  }

  startGift(gift) {
    const explicitContainer = resolveOptionalContainer(gift.container || gift.playContainer)
    const fullscreen = gift.fullscreen ?? gift.size === GIFT_SIZE.BIG
    const playContainer = explicitContainer || this.containers[gift.size]
    const bounds = fullscreen ? getContainerBounds(playContainer) : undefined
    const width = gift.width || (fullscreen ? bounds.width : this.smallWidth)
    const height = gift.height || (fullscreen ? bounds.height : this.smallHeight)
    const layer = createLayer(width, height, gift.size, fullscreen || Boolean(explicitContainer))
    const layerId = `${gift.id}-${Date.now()}`
    const renderer = new GiftRenderer({
      container: layer,
      width,
      height,
    })

    if (gift.size === GIFT_SIZE.SMALL)
      playContainer.prepend(layer)
    else
      playContainer.appendChild(layer)
    this.active[gift.size].set(layerId, { gift, layer, renderer })

    renderer.on('status', ({ status, error, type }) => {
      if (status === PLAYER_STATUS.PLAYING) {
        this.emit('start', gift)
        return
      }

      if (status === PLAYER_STATUS.ENDED) {
        this.removeGift(layerId, PLAYER_STATUS.ENDED)
        return
      }

      if (status === PLAYER_STATUS.ERROR) {
        this.emit('error', { gift, error, type })
        this.removeGift(layerId, PLAYER_STATUS.ERROR)
      }
    })

    renderer.play(gift).catch((error) => {
      this.emit('error', { gift, error })
      this.removeGift(layerId, PLAYER_STATUS.ERROR)
    })
  }

  pause(id) {
    this.getTargets(id).forEach(({ renderer }) => renderer.pause())
  }

  resume(id) {
    this.getTargets(id).forEach(({ renderer }) => renderer.resume())
  }

  setSmallMaxConcurrent(count) {
    this.maxConcurrent[GIFT_SIZE.SMALL] = Math.max(1, Number(count) || 1)
    this.processQueue(GIFT_SIZE.SMALL)
  }

  stop(id) {
    this.getTargets(id).forEach((_, layerId) => this.removeGift(layerId, 'stop'))
  }

  clear() {
    this.queues[GIFT_SIZE.BIG] = []
    this.queues[GIFT_SIZE.SMALL] = []
    this.stop()
    this.emit('clear')
  }

  destroy() {
    this.clear()
    this.events.clear()

    if (this.container.dataset.giftPlayerRoot === 'true')
      this.container.remove()
  }

  getQueue(size) {
    if (size)
      return this.queues[normalizeGiftSize(size)].slice()

    return [
      ...this.queues[GIFT_SIZE.BIG],
      ...this.queues[GIFT_SIZE.SMALL],
    ]
  }

  getActive(size) {
    if (size)
      return Array.from(this.active[normalizeGiftSize(size)].values(), item => item.gift)

    return [
      ...Array.from(this.active[GIFT_SIZE.BIG].values(), item => item.gift),
      ...Array.from(this.active[GIFT_SIZE.SMALL].values(), item => item.gift),
    ]
  }

  getTargets(id) {
    if (!id) {
      return new Map([
        ...this.active[GIFT_SIZE.BIG],
        ...this.active[GIFT_SIZE.SMALL],
      ])
    }

    return new Map([
      ...Array.from(this.active[GIFT_SIZE.BIG]),
      ...Array.from(this.active[GIFT_SIZE.SMALL]),
    ].filter(([layerId, item]) => layerId === id || item.gift.id === id))
  }

  removeGift(layerId, reason) {
    const size = this.active[GIFT_SIZE.BIG].has(layerId) ? GIFT_SIZE.BIG : GIFT_SIZE.SMALL
    const item = this.active[size].get(layerId)

    if (!item)
      return

    item.renderer.destroy()
    item.layer.remove()
    this.active[size].delete(layerId)

    if (reason === PLAYER_STATUS.ENDED)
      this.emit('ended', item.gift)

    this.processQueue(size)
  }

  emit(eventName, payload) {
    this.events.get(eventName)?.forEach(handler => handler(payload))
  }
}

export { GIFT_SIZE, PLAYER_STATUS }

class GiftRenderer {
  constructor(options = {}) {
    if (!options.container)
      throw new Error('GiftRenderer requires a container element')

    this.container = resolveContainer(options.container)
    this.width = options.width || 200
    this.height = options.height || 200
    this.status = PLAYER_STATUS.IDLE
    this.player = null
    this.playToken = 0
    this.events = new Map()
  }

  on(eventName, handler) {
    if (!this.events.has(eventName))
      this.events.set(eventName, new Set())

    this.events.get(eventName).add(handler)

    return () => this.off(eventName, handler)
  }

  off(eventName, handler) {
    this.events.get(eventName)?.delete(handler)
  }

  async play(options = {}) {
    if (!options.src)
      throw new Error('Gift source is required')

    this.destroy()
    const token = this.playToken
    this.setStatus(PLAYER_STATUS.LOADING, { type: options.type })

    try {
      if (options.type === 'vap')
        await this.playVap(options, token)
      else if (options.type === 'svga')
        await this.playSvga(options, token)
      else
        await this.playLottie(options, token)
    }
    catch (error) {
      this.setStatus(PLAYER_STATUS.ERROR, { error })
      throw error
    }
  }

  pause() {
    this.player?.pause?.()
    this.player?.pauseAnimation?.()
    this.setStatus(PLAYER_STATUS.PAUSED)
  }

  resume() {
    this.player?.play?.()
    this.player?.startAnimation?.()
    this.setStatus(PLAYER_STATUS.PLAYING)
  }

  destroy() {
    this.playToken += 1

    if (this.player) {
      try {
        this.player.destroy?.()
        this.player.stopAnimation?.()
        this.player.clear?.()
        this.player.stop?.()
      }
      catch {
        // Third-party players can throw when teardown races with media loading.
      }
    }

    this.player = null
    this.container.innerHTML = ''
  }

  async playLottie(options, token) {
    await import('@lottiefiles/lottie-player')

    if (token !== this.playToken)
      return

    const player = document.createElement('lottie-player')
    player.setAttribute('src', options.src)
    player.setAttribute('autoplay', '')
    player.setAttribute('background', options.background || 'transparent')
    player.setAttribute('speed', String(options.speed || 1))
    player.setAttribute('mode', options.mode || 'normal')
    player.style.width = '100%'
    player.style.height = '100%'

    if (options.loop)
      player.setAttribute('loop', '')

    player.addEventListener('load', () => this.setStatus(PLAYER_STATUS.PLAYING, { type: 'lottie' }))
    player.addEventListener('ready', () => this.setStatus(PLAYER_STATUS.PLAYING, { type: 'lottie' }))
    player.addEventListener('complete', () => {
      if (!options.loop)
        this.setStatus(PLAYER_STATUS.ENDED, { type: 'lottie' })
    })
    player.addEventListener('error', () => {
      this.setStatus(PLAYER_STATUS.ERROR, { type: 'lottie', error: new Error('Lottie load failed') })
    })

    this.container.appendChild(player)
    this.player = player
  }

  async playVap(options, token) {
    const module = await import('video-animation-player')
    const Vap = module.default || module

    if (token !== this.playToken)
      return

    if (!options.config)
      throw new Error('VAP config is required')

    const player = new Vap().play({
      container: this.container,
      src: options.src,
      config: options.config,
      width: options.width || this.width,
      height: options.height || this.height,
      fps: Number(options.fps) || 20,
      loop: Boolean(options.loop),
      accurate: Boolean(options.accurate),
      mute: options.mute ?? true,
      precache: options.precache ?? true,
      type: options.cacheType || Date.now(),
      onLoadError: error => this.setStatus(PLAYER_STATUS.ERROR, { type: 'vap', error }),
      ...options.mixins,
    })

    this.player = player
    player.on('playing', () => this.setStatus(PLAYER_STATUS.PLAYING, { type: 'vap' }))
    player.on('ended', () => {
      if (!options.loop)
        this.setStatus(PLAYER_STATUS.ENDED, { type: 'vap' })
    })
    player.on('error', error => this.setStatus(PLAYER_STATUS.ERROR, { type: 'vap', error }))
    player.on('frame', (frame, timestamp) => this.emit('frame', { frame, timestamp, type: 'vap' }))
  }

  async playSvga(options, token) {
    const module = await import('svgaplayerweb')
    const SVGA = module.default || module

    if (token !== this.playToken)
      return

    const player = new SVGA.Player(this.container)
    const parser = new SVGA.Parser(this.container)
    this.player = player
    player.loops = options.loop ? 0 : 1
    player.clearsAfterStop = options.clearsAfterStop ?? false
    player.setContentMode(options.contentMode || 'AspectFit')
    player.onFinished(() => this.setStatus(PLAYER_STATUS.ENDED, { type: 'svga' }))
    player.onFrame(frame => this.emit('frame', { frame, type: 'svga' }))

    parser.load(
      options.src,
      (videoItem) => {
        if (token !== this.playToken)
          return

        player.setVideoItem(videoItem)
        applySvgaDynamicObjects(player, options.dynamicObjects)
        player.startAnimation()
        this.setStatus(PLAYER_STATUS.PLAYING, { type: 'svga' })
      },
      error => this.setStatus(PLAYER_STATUS.ERROR, { type: 'svga', error }),
    )
  }

  setStatus(status, detail = {}) {
    this.status = status
    this.emit('status', { status, ...detail })

    if (status === PLAYER_STATUS.ERROR)
      this.emit('error', detail)
  }

  emit(eventName, payload) {
    this.events.get(eventName)?.forEach(handler => handler(payload))
  }
}

function normalizeGift(url, options = {}) {
  if (typeof url === 'object' && url !== null) {
    const src = url.src || url.url

    if (!src)
      throw new Error('Gift source is required')

    return {
      ...url,
      src,
      type: url.type || inferGiftType(src),
      size: normalizeGiftSize(url.size || url.giftSize || url.level),
      id: url.id || createGiftId(src),
    }
  }

  if (!url)
    throw new Error('Gift source is required')

  return {
    ...options,
    src: url,
    type: options.type || inferGiftType(url),
    size: normalizeGiftSize(options.size || options.giftSize || options.level),
    id: options.id || createGiftId(url),
  }
}

function normalizeGiftSize(size) {
  if (size === GIFT_SIZE.BIG || size === 'large' || size === 1 || size === true)
    return GIFT_SIZE.BIG

  return GIFT_SIZE.SMALL
}

function normalizeMaxConcurrent(options) {
  if (typeof options.maxConcurrent === 'object' && options.maxConcurrent !== null) {
    return {
      [GIFT_SIZE.BIG]: 1,
      [GIFT_SIZE.SMALL]: Number(options.maxConcurrent.small) || 3,
    }
  }

  return {
    [GIFT_SIZE.BIG]: 1,
    [GIFT_SIZE.SMALL]: Number(options.smallMaxConcurrent || options.maxConcurrent) || 3,
  }
}

function inferGiftType(src) {
  const pathname = String(src).split('?')[0].toLowerCase()

  if (pathname.endsWith('.svga'))
    return 'svga'

  if (pathname.endsWith('.mp4'))
    return 'vap'

  return 'lottie'
}

function createGiftId(src) {
  return `${inferGiftType(src)}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function resolveContainer(container) {
  if (typeof container === 'string') {
    const element = document.querySelector(container)

    if (!element)
      throw new Error(`Gift container "${container}" was not found`)

    return element
  }

  return container
}

function resolveOptionalContainer(container) {
  if (!container)
    return undefined

  return resolveContainer(container)
}

function createDefaultContainer() {
  const container = document.createElement('div')
  container.dataset.giftPlayerRoot = 'true'
  document.body.appendChild(container)
  return container
}

function setupContainer(container, options = {}) {
  if (options.applyContainerStyle === false)
    return

  container.style.position ||= 'fixed'
  container.style.inset ||= '0'
  container.style.zIndex ||= '9999'
  container.style.overflow ||= 'hidden'
  container.style.pointerEvents ||= 'none'
}

function createLayer(width, height, size, fullscreen) {
  const layer = document.createElement('div')
  layer.style.position = 'absolute'
  layer.style.width = fullscreen ? '100%' : `${width}px`
  layer.style.height = fullscreen ? '100%' : `${height}px`
  layer.style.display = 'grid'
  layer.style.placeItems = 'center'
  layer.style.pointerEvents = 'none'
  layer.style.zIndex = size === GIFT_SIZE.BIG ? '2' : '1'

  if (fullscreen) {
    layer.style.inset = '0'
  }
  else {
    layer.style.position = 'relative'
    layer.style.alignSelf = 'center'
    layer.style.justifySelf = 'end'
    layer.style.marginRight = '8px'
  }

  return layer
}

function getContainerBounds(container) {
  const rect = container.getBoundingClientRect?.()
  const width = Math.ceil(rect?.width || container.clientWidth || window.innerWidth)
  const height = Math.ceil(rect?.height || container.clientHeight || window.innerHeight)

  return { width, height }
}

function applySvgaDynamicObjects(player, dynamicObjects = {}) {
  Object.entries(dynamicObjects.images || {}).forEach(([key, value]) => {
    player.setImage(value.url || value, key, value.transform)
  })

  Object.entries(dynamicObjects.texts || {}).forEach(([key, value]) => {
    player.setText(value, key)
  })
}
