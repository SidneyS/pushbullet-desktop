'use strict'


/**
 * Modules (Node.js)
 * @constant
 */
const os = require('os')

/**
 * Modules (Electron)
 * @constant
 */
const electron = require('electron')
const { remote, ipcRenderer } = electron

/**
 * Modules (Third party)
 * @constant
 */
const _ = require('lodash')
const appRootPathDirectory = require('app-root-path').path
const appModulePath = require('app-module-path')
const electronEditorContextMenu = remote.require('electron-editor-context-menu')
const logger = require('@sidneys/logger')({ write: true })
const domTools = require('@sidneys/dom-tools')
const isDebug = require('@sidneys/is-env')('debug')
const notificationProvider = remote.require('@sidneys/electron-notification-provider')

/**
 * Module Configuration
 */
appModulePath.addPath(appRootPathDirectory)

/**
 * Modules (Local)
 * @constant
 */
const appFilesystem = remote.require('app/scripts/main-process/components/globals').appFilesystem
const appManifest = remote.require('app/scripts/main-process/components/globals').appManifest
const configurationManager = remote.require('app/scripts/main-process/managers/configuration-manager')
/* eslint-disable no-unused-vars */
const pbClipboard = require('app/scripts/renderer-process/pushbullet/clipboard')
const pbDevices = require('app/scripts/renderer-process/pushbullet/device')
const pbPush = require('app/scripts/renderer-process/pushbullet/push')
/* eslint-enable */


/**
 * Application
 * @constant
 * @default
 */
const appName = appManifest.name

/**
 * Filesystem
 * @constant
 * @default
 */
const appIconFile = appFilesystem.icon

/**
 * @constant
 * @default
 */
const defaultInterval = 500
const defaultTimeout = 500

/**
 * Retrieve PushbulletLastNotificationTimestamp
 * @return {Number} - timestamp
 */
let retrievePushbulletLastNotificationTimestamp = () => configurationManager('pushbulletLastNotificationTimestamp').get()

/**
 * Retrieve PushbulletRepeatRecentNotifications
 * @return {Boolean}
 */
let retrievePushbulletRepeatRecentNotifications = () => configurationManager('pushbulletRepeatRecentNotifications').get()


/**
 * Check if item push is targeted to application
 * @param {String} targetIden - Pushbullet API element iden(tity)
 * @returns {Boolean|void} - True if target
 */
let appIsTargeted = (targetIden) => {
    const pb = window.pb
    const targetDeviceModel = pb.api && pb.api.devices && pb.api.devices.objs && pb.api.devices.objs[targetIden] && pb.api.devices.objs[targetIden].model

    if (targetDeviceModel === 'pb-for-desktop') {
        return true
    }
}


/**
 * Adds application  UI keyboard navigation
 */
let injectAppKeyboardNavigation = () => {
    logger.debug('injectAppKeyboardNavigation')

    // Get current button elements
    let buttonElementList = document.querySelectorAll('.pointer')

    // Add interaction
    buttonElementList.forEach((element) => {
        element.setAttribute('tabindex', '0')
        element.onkeyup = (event) => {
            logger.debug('injectAppKeyboardNavigation', 'element.onkeyup')

            // Require Enter or Space key
            if ([ 13, 32 ].includes(event.keyCode)) {
                element.click()
            }
        }
    })
}

/**
 * Adds push message keyboard navigation & text selection
 */
let injectMessageKeyboardNavigation = () => {
    logger.debug('injectMessageKeyboardNavigation')

    // Get current message elements
    let pushElementList = document.querySelectorAll('.pushwrap .text-part > div')

    // Add interaction
    pushElementList.forEach((element) => {
        element.style.userSelect = 'all'
        element.setAttribute('tabindex', '0')

        // Ignore elements with no textual content
        if (!Boolean(element.textContent.trim())) { return }

        element.onfocus = (event) => {
            logger.debug('injectAppKeyboardNavigation', 'element.onfocus', event)

            const range = document.createRange()
            range.selectNodeContents(element)
            const selection = window.getSelection()
            selection.removeAllRanges()
            selection.addRange(range)
        }
    })
}

/**
 * User Interface tweaks
 */
let addInterfaceEnhancements = () => {
    logger.debug('addInterfaceEnhancements')

    const pb = window.pb

    let interval = setInterval(() => {
        if (!(pb && pb.api && pb.api.account)) { return }

        // Close Setup Wizard
        pb.api.account['preferences']['setup_done'] = true
        pb.sidebar.update()

        // Go to Settings
        window.onecup['goto']('/#settings')

        clearInterval(interval)
    }, defaultInterval)
}

/**
 * Proxy pb.ws
 */
let registerErrorProxy = () => {
    logger.debug('registerErrorProxy')

    const pb = window.pb

    let interval = setInterval(() => {
        if (!(pb && pb.error)) { return }

        pb.error = new Proxy(pb.error, {
            set: (pbError, property, value) => {
                //logger.debug('pb.error', 'set()', 'property:', property, 'value:', value);

                if (property === 'title' && _.isString(value)) {
                    if (value.includes('Network')) {
                        const isOnline = false

                        ipcRenderer.send('online', isOnline)
                        ipcRenderer.sendToHost('online', isOnline)
                    }
                }

                pbError[property] = value
            }
        })

        clearInterval(interval)
    }, defaultInterval)
}

/**
 * Proxy pb.api.texts.objs
 */
let registerTextsProxy = () => {
    logger.debug('registerTextsProxy')

    /** @namespace pb.api.texts */
    const pb = window.pb

    let interval = setInterval(() => {
        if (!(pb && pb.api && pb.api.texts)) { return }

        pb.api.texts.objs = new Proxy(pb.api.texts.objs, {
            set: (textsObjs, property, value) => {
                logger.debug('pb.api.texts.objs', 'set()', 'property:', property, 'value:', value)

                // Check if text with iden exists
                let exists = Boolean(pb.api.texts.all.filter((text) => {
                    return text.iden === value.iden
                }).length)

                if (!exists) {
                    const isTarget = value.data && value.data.hasOwnProperty('target_device_iden') ? appIsTargeted(value.data.target_device_iden) : true

                    if (isTarget) {
                        pbPush.enqueuePushes(value)
                    }
                }

                textsObjs[property] = value
            }
        })

        clearInterval(interval)
    }, defaultInterval)
}

/**
 * Proxy pb.api.pushes.objs
 */
let registerPushProxy = () => {
    logger.debug('registerPushProxy')

    const pb = window.pb

    let interval = setInterval(() => {
        if (!(pb && pb.api && pb.api.pushes)) { return }

        pb.api.pushes.objs = new Proxy(pb.api.pushes.objs, {
            set: (pushesObjs, property, value) => {

                // Check if push with iden exists
                let exists = Boolean(pb.api.pushes.all.filter((push) => {
                    return push.iden === value.iden
                }).length)

                if (!exists) {
                    const isTarget = value.hasOwnProperty('target_device_iden') ? appIsTargeted(value.target_device_iden) : true
                    const isIncoming = value.hasOwnProperty('direction') ? value.direction !== 'outgoing' : true

                    if (isTarget && isIncoming) {
                        pbPush.enqueuePushes(value)
                    }
                }

                pushesObjs[property] = value
            }
        })

        clearInterval(interval)
    }, defaultInterval)
}

/**
 * Listen for Pushbullet Stream
 */
let addWebsocketEventHandlers = () => {
    logger.debug('addWebsocketEventHandlers')

    const pb = window.pb

    let interval = setInterval(() => {
        if (!(pb && pb.ws && pb.ws.socket)) { return }

        pb.ws.socket.addEventListener('message', (ev) => {
            // logger.debug('pb.ws.socket#message')

            let message

            try {
                message = JSON.parse(ev.data)
            } catch (err) {
                logger.warn('pb.ws.socket#message', err.message)
                return
            }

            logger.debug('pb.ws.socket#message', 'type:', message.type)

            if (message.type !== 'push') { return }

            /**
             * Decryption
             */
            if (message.push.encrypted) {
                if (!pb.e2e.enabled) {
                    const notificationOptions = {
                        body: `Could not decrypt message.${os.EOL}Click here to enter your password.`,
                        icon: appIconFile,
                        subtitle: 'End-to-End Encryption',
                        title: appName
                    }

                    /**
                     * Create
                     */
                    const notification = notificationProvider.create(notificationOptions)

                    /**
                     * @listens notification:PointerEvent#click
                     */
                    notification.on('click', () => {
                        logger.debug('notification#click')

                        window.onecup['goto']('/#settings')
                    })

                    /**
                     * Show
                     */
                    notification.show()
                } else {
                    try {
                        message.push = JSON.parse(pb.e2e.decrypt(message.push.ciphertext))
                    } catch (error) {
                        logger.warn('pb.ws.socket#message', 'error.message:', error.message)
                        return
                    }
                }
            }

            if (!(message.push && message.push.type)) { return }

            logger.debug('pb.ws.socket#message', 'message.push.type:', message.push.type)

            switch (message.push.type) {
                /** Mirroring */
                case 'mirror':
                /** SMS */
                case 'sms_changed':
                    pbPush.enqueuePushes(message.push, true)
                    break
                /** Clipboard */
                case 'clip':
                    pbClipboard.receiveClip(message.push)
                    break
            }
        })

        clearInterval(interval)
    }, defaultInterval)
}

/**
 * Login Pushbullet User
 */
let loginPushbulletUser = () => {
    logger.debug('loginPushbulletUser')

    const pb = window.pb

    let interval = setInterval(() => {
        if (!(pb && pb.account && pb.account.active)) { return }
        logger.info('Pushbullet.com', 'login:', pb.account.email)

        pb.DEBUG = isDebug

        registerErrorProxy()
        registerPushProxy()
        registerTextsProxy()
        addWebsocketEventHandlers()

        const lastNotificationTimestamp = retrievePushbulletLastNotificationTimestamp()
        if (lastNotificationTimestamp) {
            let unreadCount = (pb.api.pushes.all.concat(pb.api.texts.all)).filter((item) => {
                return (item.created) > lastNotificationTimestamp
            }).length

            logger.debug('Pushbullet.com', 'unread notifications:', unreadCount)

            pbPush.updateBadge(unreadCount)
        }

        if (retrievePushbulletRepeatRecentNotifications()) {
            pbPush.enqueueRecentPushes((error, count) => {
                if (error) {
                    logger.warn('Pushbullet.com', 'replaying recent pushes', error)
                }
                logger.info('Pushbullet.com', 'replaying recent pushes', 'count:', count)
            })
        }

        const isLogin = true

        ipcRenderer.send('login', isLogin)
        ipcRenderer.sendToHost('login', isLogin)

        addInterfaceEnhancements()

        clearInterval(interval)
    }, defaultInterval)
}


/**
 * Init
 */
let init = () => {
    logger.debug('init')

    const pb = window.pb

    let interval = setInterval(() => {
        if (!pb || !navigator.onLine) { return }
        logger.info('Pushbullet.com', 'connection established')

        ipcRenderer.send('online', true)
        ipcRenderer.sendToHost('online', true)

        loginPushbulletUser()

        clearInterval(interval)
    }, defaultInterval)
}


/**
 * @listens process#loaded
 */
const _setImmediate = setImmediate
process.once('loaded', () => {
    global.setImmediate = _setImmediate
})

/**
 * @listens ipcRenderer:did-navigate-in-page
 */
ipcRenderer.on('did-navigate-in-page', () => {
    logger.debug('ipcRenderer#did-navigate-in-page')

    // Inject interface improvements
    injectAppKeyboardNavigation()
    injectMessageKeyboardNavigation()
})


/**
 * @listens window:Event:contextmenu
 */
window.addEventListener('contextmenu', (event) => {
    logger.debug('window#contextmenu')

    if (!event.target['closest']('textarea, input, [contenteditable="true"]')) {
        return
    }

    let timeout = setTimeout(() => {
        electronEditorContextMenu().popup()

        clearTimeout(timeout)
    }, defaultTimeout)
})

/**
 * @listens window:Event#offline
 */
window.addEventListener('offline', () => {
    logger.debug('window#offline')

    ipcRenderer.send('online', false)
    ipcRenderer.sendToHost('online', false)
})

/**
 * @listens window:Event#offline
 */
window.addEventListener('online', () => {
    logger.debug('window#online')

    ipcRenderer.send('online', true)
    ipcRenderer.sendToHost('online', true)
})

/**
 * @listens window:Event#load
 */
window.addEventListener('load', () => {
    logger.debug('window#load')

    domTools.addPlatformClass()

    init()
})

