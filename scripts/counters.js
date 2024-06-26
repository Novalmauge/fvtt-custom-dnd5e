import { CONSTANTS, MODULE, SETTING_BY_ACTOR_TYPE, SHEET_TYPE } from './constants.js'
import { Logger, checkEmpty, getFlag, setFlag, unsetFlag, getSetting, registerMenu, registerSetting, makeDead } from './utils.js'
import { CountersForm } from './forms/counters-form.js'

/**
 * Register Settings
 */
export function registerSettings () {
    registerMenu(
        CONSTANTS.COUNTERS.MENU.KEY,
        {
            hint: game.i18n.localize(CONSTANTS.COUNTERS.MENU.HINT),
            label: game.i18n.localize(CONSTANTS.COUNTERS.MENU.LABEL),
            name: game.i18n.localize(CONSTANTS.COUNTERS.MENU.NAME),
            icon: CONSTANTS.COUNTERS.MENU.ICON,
            type: CountersForm,
            restricted: true,
            scope: 'world'
        }
    )

    registerSetting(
        CONSTANTS.COUNTERS.SETTING.CHARACTER_COUNTERS.KEY,
        {
            scope: 'world',
            config: false,
            type: Object
        }
    )

    registerSetting(
        CONSTANTS.COUNTERS.SETTING.NPC_COUNTERS.KEY,
        {
            scope: 'world',
            config: false,
            type: Object
        }
    )

    registerSetting(
        CONSTANTS.COUNTERS.SETTING.GROUP_COUNTERS.KEY,
        {
            scope: 'world',
            config: false,
            type: Object
        }
    )

    Logger.debug(
        'Loading templates',
        [
            CONSTANTS.COUNTERS.TEMPLATE.FORM,
            CONSTANTS.COUNTERS.TEMPLATE.LIST,
            CONSTANTS.COUNTERS.TEMPLATE.ADVANCED_OPTIONS_FORM,
            CONSTANTS.COUNTERS.TEMPLATE.ADVANCED_OPTIONS_LIST
        ]
    )

    loadTemplates([
        CONSTANTS.COUNTERS.TEMPLATE.FORM,
        CONSTANTS.COUNTERS.TEMPLATE.LIST,
        CONSTANTS.COUNTERS.TEMPLATE.ADVANCED_OPTIONS_FORM,
        CONSTANTS.COUNTERS.TEMPLATE.ADVANCED_OPTIONS_LIST
    ])
}

/**
 * HOOKS
 */
Hooks.on('renderInnerActorSheet', (app, html, data) => {
    const sheetType = SHEET_TYPE[app.constructor.name]

    if (!sheetType) return

    if (sheetType.group) {
        addCountersGroup(app, html, data, sheetType)
        return
    }

    if (sheetType) {
        sheetType.legacy
            ? addCountersLegacy(app, html, data, sheetType)
            : addCounters(app, html, data, sheetType)
    }
})

Hooks.on('preUpdateActor', (actor, data, options) => {
    const currentHp = getProperty(data ?? {}, 'system.attributes.hp.value')

    if (typeof currentHp === 'undefined') return

    const previousHp = actor.system.attributes.hp.value
    const halfHp = actor.system.attributes.hp.max * 0.5

    if (currentHp <= halfHp && previousHp > halfHp) {
        onTriggerHalfHp(actor)
    }
})

Hooks.on('updateActor', (actor, data, options) => {
    const hp = getProperty(data ?? {}, 'system.attributes.hp.value')

    if (hp === 'undefined') return

    if (hp === 0) {
        onTriggerZeroHp(actor)
    }

    if (Object.hasOwn(data, 'flags') && data.flags[MODULE.ID]) {
        onTriggerCounterValue(actor, data)
    }
})

Hooks.on('deleteCombat', (combat, options, key) => {
    const combatants = combat.combatants
    combatants.forEach(combatant => {
        const actor = combatant.actor
        const flag = getFlag(actor, 'zeroHpCombatEnd')
        if (flag) {
            const setting = getSettingByActorType(actor.type)
            Object.entries(setting).forEach(([key, value]) => {
                const triggers = value.triggers
                if (!triggers) return
                triggers
                    .filter(trigger => trigger.trigger === 'zeroHpCombatEnd')
                    .forEach(trigger => handleAction(actor, key, trigger, value.type))
            })
            unsetFlag(actor, 'zeroHpCombatEnd')
        }
    })
})

Hooks.on('dnd5e.preRestCompleted', (actor, data) => {
    const restType = (data.longRest) ? 'longRest' : 'shortRest'
    onTriggerRest(restType, actor)
})

/**
 * Handler for 'zeroHp' trigger
 * @param {object} actor The actor
 */
function onTriggerZeroHp (actor) {
    const setting = getSettingByActorType(actor.type)

    if (!setting) return

    Object.entries(setting).forEach(([key, value]) => {
        const triggers = value.triggers
        if (!triggers) return
        triggers
            .filter(trigger => trigger.trigger === 'zeroHp')
            .forEach(trigger => handleAction(actor, key, trigger, value.type))
        const zeroHpCombatEnd = triggers.find(trigger => trigger.trigger === 'zeroHpCombatEnd')
        if (actor.inCombat && zeroHpCombatEnd) {
            setFlag(actor, 'zeroHpCombatEnd', true)
        }
    })
}

/**
 * Handler for 'halfHp' trigger
 * @param {object} actor The actor
 */
function onTriggerHalfHp (actor) {
    const setting = getSettingByActorType(actor.type)

    if (!setting) return

    Object.entries(setting).forEach(([key, value]) => {
        const triggers = value.triggers
        if (!triggers) return
        triggers
            .filter(trigger => trigger.trigger === 'halfHp')
            .forEach(trigger => handleAction(actor, key, trigger, value.type))
    })
}

/**
 * Handler for 'counterValue' trigger
 * @param {object} actor The actor
 * @param {object} data  The update data
 */
function onTriggerCounterValue (actor, data) {
    const setting = getSettingByActorType(actor.type)

    if (!setting) return

    Object.entries(setting).forEach(([key, value]) => {
        const counterValue = data.flags[MODULE.ID][key]
        if (!counterValue && counterValue !== 0) return
        const triggers = value.triggers
        if (!triggers) return
        triggers
            .filter(trigger => trigger.trigger === 'counterValue' && trigger.triggerValue === counterValue)
            .forEach(trigger => handleAction(actor, key, trigger, value.type))
    })
}

/**
 * Handler for 'longRest' and 'shortRest' triggers
 * @param {string} restType The rest type: longRest or shortRest
 * @param {object} actor    The actor=
 */
function onTriggerRest (restType, actor) {
    const setting = getSettingByActorType(actor.type)

    if (!setting) return

    Object.entries(setting).forEach(([key, value]) => {
        const triggers = value.triggers
        if (!triggers) return
        triggers
            .filter(trigger => trigger.trigger === restType)
            .forEach(trigger => handleAction(actor, key, trigger, value.type))
    })
}

/**
 * Handler for a trigger action
 * @param {object} actor   The actor
 * @param {string} key     The counter key
 * @param {object} trigger The trigger
 * @param {string} type    The counter type
 */
function handleAction (actor, key, trigger, type) {
    switch (trigger.action) {
    case 'check':
        checkCheckbox(actor, key)
        break
    case 'uncheck':
        uncheckCheckbox(actor, key)
        break
    case 'increase':
        handleIncreaseAction(actor, key, trigger, type)
        break
    case 'decrease':
        handleDecreaseAction(actor, key, trigger, type)
        break
    case 'dead':
        makeDead(actor)
        break
    }
}

/**
 * Handler for the 'increase' action
 * @param {object} actor   The actor
 * @param {string} key     The counter key
 * @param {object} trigger The trigger
 * @param {string} type    The counter type
*/
function handleIncreaseAction (actor, key, trigger, type) {
    switch (type) {
    case 'fraction':
        increaseFraction(actor, key, trigger.actionValue)
        break
    case 'number':
        increaseNumber(actor, key, trigger.actionValue)
        break
    }
}

/**
 * Handler for the 'decrease' action
 * @param {object} actor   The actor
 * @param {string} key     The counter key
 * @param {object} trigger The trigger
 * @param {string} type    The counter type
 */
function handleDecreaseAction (actor, key, trigger, type) {
    switch (type) {
    case 'fraction':
        decreaseFraction(actor, key, trigger.actionValue)
        break
    case 'number':
        decreaseNumber(actor, key, trigger.actionValue)
        break
    }
}

/**
 * Add counters to the group sheet
 * @param {object} app       The app
 * @param {object} html      The HTML
 * @param {object} data      The data
 * @param {string} sheetType The actor sheet type
 */
function addCountersGroup (app, html, data, sheetType) {
    const actor = app.actor
    const counters = game.settings.get(MODULE.ID, sheetType.countersSetting)

    if (checkEmpty(counters)) return

    const nav = html[0].querySelector('nav.sheet-navigation.tabs')
    const navItem = document.createElement('a')
    navItem.classList.add('item')
    navItem.setAttribute('data-tab', 'custom-dnd5e-counters')
    navItem.textContent = game.i18n.localize('CUSTOM_DND5E.counters')
    nav.appendChild(navItem)

    const body = html[0].querySelector('section.sheet-body')
    const tab = document.createElement('div')
    tab.classList.add('tab', 'custom-dnd5e-counters')
    tab.setAttribute('data-group', 'primary')
    tab.setAttribute('data-tab', 'custom-dnd5e-counters')

    const ul = tab.appendChild(document.createElement('ul'))

    for (const [key, counter] of Object.entries(counters)) {
        if (!counter.visible || (counter.viewRole && game.user.role < counter.viewRole)) continue

        ul.appendChild(createCounterItem(actor, key, counter))
    }

    if (Object.values(counters).some(c => !c.system && c.visible)) {
        body.appendChild(tab)
    }
}

/**
 * Add counters to the sheet
 * @param {object} app       The app
 * @param {object} html      The HTML
 * @param {object} data      The data
 * @param {string} sheetType The actor sheet type
 */
function addCounters (app, html, data, sheetType) {
    const actor = app.actor
    const counters = game.settings.get(MODULE.ID, sheetType.countersSetting)

    if (checkEmpty(counters)) return

    const detailsRightDiv = html[0].querySelector('.tab.details > .right')
    const detailsRightTopDiv = detailsRightDiv.querySelector('.top')
    const countersDiv = createCountersDiv()
    const ul = countersDiv.appendChild(document.createElement('ul'))

    for (const [key, counter] of Object.entries(counters)) {
        if (!counter.visible || (counter.viewRole && game.user.role < counter.viewRole)) continue

        ul.appendChild(createCounterItem(actor, key, counter))
    }

    if (Object.values(counters).some(c => !c.system && c.visible)) {
        detailsRightTopDiv.after(countersDiv)
    }
}

/**
 * Create the Counters section
 * @returns {object} The DIV
 */
function createCountersDiv () {
    const div = document.createElement('div')
    div.classList.add('custom-dnd5e-counters-counters')

    const h3 = document.createElement('h3')
    h3.setAttribute('class', 'icon')
    div.appendChild(h3)

    const i = document.createElement('i')
    i.classList.add('fas', 'fa-scroll')
    h3.appendChild(i)

    const span = document.createElement('span')
    span.setAttribute('class', 'roboto-upper')
    span.textContent = game.i18n.localize('CUSTOM_DND5E.counters')
    h3.appendChild(span)

    return div
}

function createCounterItem (actor, key, counter) {
    let li = null
    switch (counter.type) {
    case 'checkbox': li = createCheckbox(actor, key, counter); break
    case 'number': li = createNumber(actor, key, counter); break
    case 'successFailure': li = createSuccessFailure(actor, key, counter); break
    case 'fraction': li = createFraction(actor, key, counter)
    }
    return li
}

/**
 * Create a checkbox counter
 * @param {object} actor   The actor
 * @param {string} key     The counter key
 * @param {object} counter The counter
 * @returns {object}       The LI
 */
function createCheckbox (actor, key, counter) {
    const li = document.createElement('li')
    li.classList.add('custom-dnd5e-counters-counter', 'flexrow', key)

    const label = document.createElement('label')
    label.setAttribute('class', 'flexrow')
    li.appendChild(label)

    const h4 = document.createElement('h4')
    label.appendChild(h4)

    if (!counter.editRole || game.user.role >= counter.editRole) {
        const a = document.createElement('a')
        a.textContent = counter.label
        h4.appendChild(a)
    } else {
        h4.textContent = counter.label
    }

    const input = document.createElement('input')
    input.setAttribute('type', 'checkbox')
    input.setAttribute('name', `flags.${MODULE.ID}.${key}`)
    input.checked = actor.getFlag(MODULE.ID, key) || false
    input.setAttribute('value', actor.getFlag(MODULE.ID, key) || false)
    input.setAttribute('placeholder', 'false')
    input.setAttribute('data-dtype', 'Boolean')
    if (counter.editRole && game.user.role < counter.editRole) {
        input.setAttribute('disabled', 'true')
    }
    label.appendChild(input)

    return li
}

/**
 * Create a fraction counter
 * @param {object} actor   The actor
 * @param {string} key     The counter key
 * @param {object} counter The counter
 * @returns {object}       The LI
 */
function createFraction (actor, key, counter) {
    const settingMax = getMax(actor, key)

    const li = document.createElement('li')
    li.classList.add('custom-dnd5e-counters-counter', 'flexrow', key)

    const h4 = document.createElement('h4')
    li.appendChild(h4)

    if (!counter.editRole || game.user.role >= counter.editRole) {
        const a = document.createElement('a')
        a.textContent = counter.label
        a.addEventListener('click', () => decreaseFraction(actor, key))
        a.addEventListener('contextmenu', () => increaseFraction(actor, key))
        h4.appendChild(a)
    } else {
        h4.textContent = counter.label
    }

    const div = document.createElement('div')
    div.classList.add('custom-dnd5e-counters-counter-value', 'custom-dnd5e-counters-fraction', key)
    li.appendChild(div)

    const divGroup = document.createElement('div')
    divGroup.classList.add('custom-dnd5e-counters-fraction-group', key)
    div.appendChild(divGroup)

    const inputValue = document.createElement('input')
    inputValue.setAttribute('type', 'number')
    inputValue.setAttribute('name', `flags.${MODULE.ID}.${key}.value`)
    inputValue.setAttribute('value', actor.getFlag(MODULE.ID, `${key}.value`))
    inputValue.setAttribute('placeholder', '0')
    inputValue.setAttribute('data-dtype', 'Number')
    if (counter.editRole && game.user.role < counter.editRole) {
        inputValue.classList.add('disabled')
        inputValue.setAttribute('disabled', 'true')
    } else {
        inputValue.addEventListener('click', event => selectInputContent(event))
        inputValue.addEventListener('keyup', () => checkValue(inputValue, actor, key))
    }
    divGroup.appendChild(inputValue)

    const span = document.createElement('span')
    span.classList.add('dnd5e-custom-counters-separator')
    span.textContent = '/'
    divGroup.appendChild(span)

    const inputMax = document.createElement('input')
    inputMax.setAttribute('type', 'number')
    inputMax.setAttribute('name', `flags.${MODULE.ID}.${key}.max`)
    inputMax.setAttribute('value', settingMax || actor.getFlag(MODULE.ID, `${key}.max`))
    inputMax.setAttribute('placeholder', '0')
    inputMax.setAttribute('data-dtype', 'Number')
    if ((counter.editRole && game.user.role < counter.editRole) || settingMax) {
        inputMax.classList.add('disabled')
        inputMax.setAttribute('disabled', 'true')
    } else {
        inputMax.addEventListener('click', event => selectInputContent(event))
    }
    divGroup.appendChild(inputMax)

    return li
}

/**
 * Create a number counter
 * @param {object} actor   The actor
 * @param {string} key     The counter key
 * @param {object} counter The counter
 * @returns {object}       The LI
 */
function createNumber (actor, key, counter) {
    const li = document.createElement('li')
    li.classList.add('custom-dnd5e-counters-counter', 'flexrow', key)
    const h4 = document.createElement('h4')
    li.appendChild(h4)

    if (!counter.editRole || game.user.role >= counter.editRole) {
        const a = document.createElement('a')
        a.textContent = counter.label
        a.addEventListener('click', () => { increaseNumber(actor, key) })
        a.addEventListener('contextmenu', () => decreaseNumber(actor, key))
        h4.appendChild(a)
    } else {
        h4.textContent = counter.label
    }

    const div = document.createElement('div')
    div.classList.add('custom-dnd5e-counters-counter-value', 'custom-dnd5e-counters-number')
    li.appendChild(div)
    const input = document.createElement('input')
    input.setAttribute('type', 'number')
    input.setAttribute('name', `flags.${MODULE.ID}.${key}`)
    input.setAttribute('value', actor.getFlag(MODULE.ID, key) || 0)
    input.setAttribute('placeholder', '0')
    input.setAttribute('data-dtype', 'Number')
    if (counter.editRole && game.user.role < counter.editRole) {
        input.classList.add('disabled')
        input.setAttribute('disabled', 'true')
    } else {
        input.addEventListener('click', event => selectInputContent(event))
        input.addEventListener('keyup', () => checkValue(input, actor, key), true)
    }
    div.appendChild(input)

    return li
}

/**
 * Create a success/failure counter
 * @param {object} actor   The actor
 * @param {string} key     The counter key
 * @param {object} counter The counter
 * @returns {object}       The LI
 */
function createSuccessFailure (actor, key, counter) {
    const li = document.createElement('li')
    li.classList.add('custom-dnd5e-counters-counter', 'flexrow', key)

    const h4 = document.createElement('h4')
    h4.textContent = counter.label
    li.appendChild(h4)

    const div = document.createElement('div')
    div.classList.add('custom-dnd5e-counters-counter-value', 'custom-dnd5e-counters-success-failure', key)
    li.appendChild(div)

    const iSuccess = document.createElement('i')
    iSuccess.classList.add('fas', 'fa-check')

    if (!counter.editRole || game.user.role >= counter.editRole) {
        const aSuccess = document.createElement('a')
        aSuccess.addEventListener('click', () => increaseSuccess(actor, key))
        aSuccess.addEventListener('contextmenu', () => decreaseSuccess(actor, key))
        div.appendChild(aSuccess)
        aSuccess.appendChild(iSuccess)
    } else {
        div.appendChild(iSuccess)
    }

    const inputSuccess = document.createElement('input')
    inputSuccess.setAttribute('type', 'number')
    inputSuccess.setAttribute('name', `flags.${MODULE.ID}.${key}.success`)
    inputSuccess.setAttribute('value', actor.getFlag(MODULE.ID, `${key}.success`) || 0)
    inputSuccess.setAttribute('placeholder', '0')
    inputSuccess.setAttribute('data-dtype', 'Number')

    if (counter.editRole && game.user.role < counter.editRole) {
        inputSuccess.classList.add('disabled')
        inputSuccess.setAttribute('disabled', 'true')
    } else {
        inputSuccess.addEventListener('click', event => selectInputContent(event))
        inputSuccess.addEventListener('keyup', () => checkValue(inputSuccess, actor, key), true)
    }

    div.appendChild(inputSuccess)

    const iFailure = document.createElement('i')
    iFailure.classList.add('fas', 'fa-times')

    if (!counter.editRole || game.user.role >= counter.editRole) {
        const aFailure = document.createElement('a')
        aFailure.addEventListener('click', () => increaseFailure(actor, key))
        aFailure.addEventListener('contextmenu', () => decreaseFailure(actor, key))
        div.appendChild(aFailure)
        aFailure.appendChild(iFailure)
    } else {
        div.appendChild(iFailure)
    }

    const inputFailure = document.createElement('input')
    inputFailure.setAttribute('type', 'number')
    inputFailure.setAttribute('name', `flags.${MODULE.ID}.${key}.failure`)
    inputFailure.setAttribute('value', actor.getFlag(MODULE.ID, `${key}.failure`) || 0)
    inputFailure.setAttribute('placeholder', '0')
    inputFailure.setAttribute('data-dtype', 'Number')

    if (counter.editRole && game.user.role < counter.editRole) {
        inputFailure.classList.add('disabled')
        inputFailure.setAttribute('disabled', 'true')
    } else {
        inputFailure.addEventListener('click', event => selectInputContent(event))
        inputFailure.addEventListener('keyup', () => checkValue(inputFailure, actor, key), true)
    }

    div.appendChild(inputFailure)

    return li
}

/**
 * Select content of an input
 * @param {object} event The event
 */
function selectInputContent (event) {
    const input = event.target
    input.select()
    input.focus()
}

/**
 * Check input value against max
 * @param {object} input The input
 * @param {object} actor The actor
 * @param {object} key   The counter key
 */
function checkValue (input, actor, key) {
    const max = getMax(actor, key) || actor.getFlag(MODULE.ID, `${key}.max`)
    if (max && input.value > max) {
        input.value = max
    }
}

/**
 * Check checkbox counter
 * @param {object} actor The actor
 * @param {string} key   The counter key
 */
function checkCheckbox (actor, key) {
    actor.setFlag(MODULE.ID, key, true)
}

/**
 * Uncheck checkbox counter
 * @param {object} actor The actor
 * @param {string} key   The counter key
 */
function uncheckCheckbox (actor, key) {
    actor.setFlag(MODULE.ID, key, false)
}

/**
 * Decrease fraction counter
 * @param {object} actor       The actor
 * @param {string} key         The counter key
 * @param {number} actionValue The action value
 */
function decreaseFraction (actor, key, actionValue = 1) {
    const oldValue = actor.getFlag(MODULE.ID, `${key}.value`) || 0
    const newValue = Math.max(oldValue - actionValue, 0)
    if (oldValue > 0) {
        actor.setFlag(MODULE.ID, `${key}.value`, newValue)
    }
}

/**
 * Increase fraction counter
 * @param {object} actor       The actor
 * @param {string} key         The counter key
 * @param {number} actionValue The action value
 */
function increaseFraction (actor, key, actionValue = 1) {
    const oldValue = actor.getFlag(MODULE.ID, `${key}.value`) || 0
    const maxValue = getMax(actor, key) || actor.getFlag(MODULE.ID, `${key}.max`)
    const newValue = (maxValue) ? Math.min(oldValue + actionValue, maxValue) : oldValue + actionValue

    if (!maxValue || newValue <= maxValue) {
        actor.setFlag(MODULE.ID, `${key}.value`, newValue)
    }
}

/**
 * Decrease number counter
 * @param {object} actor       The actor
 * @param {string} key         The counter key
 * @param {number} actionValue The action value
 */
function decreaseNumber (actor, key, actionValue = 1) {
    const oldValue = actor.getFlag(MODULE.ID, key) || 0
    const newValue = Math.max(oldValue - actionValue, 0)
    if (oldValue > 0) {
        actor.setFlag(MODULE.ID, key, newValue)
    }
}

/**
 * Increase number counter
 * @param {object} actor       The actor
 * @param {string} key         The counter key
 * @param {number} actionValue The action value
 */
function increaseNumber (actor, key, actionValue = 1) {
    const oldValue = actor.getFlag(MODULE.ID, key) || 0
    const maxValue = getMax(actor, key) || actor.getFlag(MODULE.ID, `${key}.max`)
    const newValue = (maxValue) ? Math.min(oldValue + actionValue, maxValue) : oldValue + actionValue

    if (!maxValue || newValue <= maxValue) {
        actor.setFlag(MODULE.ID, key, newValue)
    }
}

/**
 * Decrease success on successFailure counter
 * @param {object} actor       The actor
 * @param {string} key         The counter key
 * @param {number} actionValue The action value
 */
function decreaseSuccess (actor, key, actionValue = 1) {
    const oldValue = actor.getFlag(MODULE.ID, `${key}.success`) || 0
    const newValue = Math.max(oldValue - actionValue, 0)
    if (oldValue > 0) {
        actor.setFlag(MODULE.ID, `${key}.success`, newValue)
    }
}

/**
 * Increase success on successFailure counter
 * @param {object} actor       The actor
 * @param {string} key         The counter key
 * @param {number} actionValue The action value
 */
function increaseSuccess (actor, key, actionValue = 1) {
    const oldValue = actor.getFlag(MODULE.ID, `${key}.success`) || 0
    const maxValue = getMax(actor, key) || actor.getFlag(MODULE.ID, `${key}.max`)
    const newValue = (maxValue) ? Math.min(oldValue + actionValue, maxValue) : oldValue + actionValue

    if (!maxValue || newValue <= maxValue) {
        actor.setFlag(MODULE.ID, `${key}.success`, newValue)
    }
}

/**
 * Decrease failure on successFailure counter
 * @param {object} actor       The actor
 * @param {string} key         The counter key
 * @param {number} actionValue The action value
 */
function decreaseFailure (actor, key, actionValue = 1) {
    const oldValue = actor.getFlag(MODULE.ID, `${key}.failure`) || 0
    const newValue = Math.max(oldValue - actionValue, 0)
    if (oldValue > 0) {
        actor.setFlag(MODULE.ID, `${key}.failure`, newValue)
    }
}

/**
 * Increase failure on successFailure counter
 * @param {object} actor        The actor
 * @param {string} key          The counter key
  * @param {number} actionValue The action value
 */
function increaseFailure (actor, key, actionValue = 1) {
    const oldValue = actor.getFlag(MODULE.ID, `${key}.failure`) || 0
    const maxValue = getMax(actor, key) || actor.getFlag(MODULE.ID, `${key}.max`)
    const newValue = (maxValue) ? Math.min(oldValue + actionValue, maxValue) : oldValue + actionValue

    if (!maxValue || newValue <= maxValue) {
        actor.setFlag(MODULE.ID, `${key}.failure`, newValue)
    }
}

/**
 * Get counter setting by the actor type
 * @param {object} actor The actor
 * @param {string} key   The counter key
 * @returns {object}     The counter setting
 */
function getSettingByActorType (actorType, key = null) {
    const settingKey = SETTING_BY_ACTOR_TYPE.COUNTERS[actorType]
    return (key) ? getSetting(settingKey)[key] : getSetting(settingKey)
}

/**
 * Get the counter's max value
 * @param {object} actor The actor
 * @param {string} key   The counter key
 * @returns {number}     The max value
 */
function getMax (actor, key) {
    const setting = getSettingByActorType(actor.type, key)
    return setting?.max
}

/**
 * Add counters to the legacy sheet
 * @param {object} app       The app
 * @param {object} html      The HTML
 * @param {object} data      The data
 * @param {string} sheetType The actor sheet type
 */
function addCountersLegacy (app, html, data, sheetType) {
    const actor = app.actor
    const counters = game.settings.get(MODULE.ID, sheetType.countersSetting)

    if (checkEmpty(counters)) return

    const countersDiv = html.find('.counters')

    for (const [key, counter] of Object.entries(counters)) {
        if (!counter.visible || (counter.viewRole && game.user.role < counter.viewRole)) {
            continue
        }

        const settingMax = getMax(actor, key)

        const counterDiv = document.createElement('div')
        counterDiv.classList.add('counter', 'flexrow', key)

        const h4 = document.createElement('h4')
        const h4Text = document.createTextNode(counter.label)
        h4.append(h4Text)

        const counterValueDiv = document.createElement('div')
        counterValueDiv.classList.add('counter-value')

        const counterInput1 = document.createElement('input')
        const counterInput2 = document.createElement('input')

        if (counter.editRole && game.user.role < counter.editRole) {
            counterInput1.classList.add('disabled')
            counterInput1.setAttribute('disabled', 'true')
            counterInput2.classList.add('disabled')
            counterInput2.setAttribute('disabled', 'true')
        }

        switch (counter.type) {
        case 'checkbox':
            counterInput1.setAttribute('type', 'checkbox')
            counterInput1.setAttribute('name', `flags.${MODULE.ID}.${key}`)
            counterInput1.checked = app.actor.getFlag(MODULE.ID, key) || false
            counterInput1.setAttribute('value', app.actor.getFlag(MODULE.ID, key) || false)
            counterInput1.setAttribute('placeholder', 'false')
            counterInput1.setAttribute('data-dtype', 'Boolean')
            if (counter.editRole && game.user.role < counter.editRole) {
                counterInput1.setAttribute('disabled', 'true')
            }
            break
        case 'fraction':
            counterInput1.setAttribute('type', 'text')
            counterInput1.setAttribute('name', `flags.${MODULE.ID}.${key}.value`)
            counterInput1.setAttribute('value', app.actor.getFlag(MODULE.ID, `${key}.value`) || 0)
            counterInput1.setAttribute('placeholder', '0')
            counterInput1.setAttribute('data-dtype', 'Number')
            if (counter.editRole && game.user.role < counter.editRole) {
                counterInput1.classList.add('disabled')
                counterInput1.setAttribute('disabled', 'true')
            } else {
                counterInput1.addEventListener('keyup', () => checkValue(counterInput1, actor, key), true)
            }
            counterInput2.setAttribute('type', 'text')
            counterInput2.setAttribute('name', `flags.${MODULE.ID}.${key}.max`)
            counterInput2.setAttribute('value', settingMax || app.actor.getFlag(MODULE.ID, `${key}.max`) || 0)
            if (settingMax || (counter.editRole && game.user.role < counter.editRole)) {
                counterInput2.classList.add('disabled')
                counterInput2.setAttribute('disabled', 'true')
            }
            counterInput2.setAttribute('placeholder', '0')
            counterInput2.setAttribute('data-dtype', 'Number')
            break
        case 'number':
            counterInput1.setAttribute('type', 'text')
            counterInput1.setAttribute('name', `flags.${MODULE.ID}.${key}`)
            counterInput1.setAttribute('value', app.actor.getFlag(MODULE.ID, key) || 0)
            counterInput1.setAttribute('placeholder', '0')
            counterInput1.setAttribute('data-dtype', 'Number')
            if (counter.editRole && game.user.role < counter.editRole) {
                counterInput1.classList.add('disabled')
                counterInput1.setAttribute('disabled', 'true')
            } else {
                counterInput1.addEventListener('keyup', () => checkValue(counterInput1, actor, key), true)
            }
            break
        case 'successFailure':
            counterInput1.setAttribute('type', 'text')
            counterInput1.setAttribute('name', `flags.${MODULE.ID}.${key}.success`)
            counterInput1.setAttribute('value', app.actor.getFlag(MODULE.ID, `${key}.success`) || 0)
            counterInput1.setAttribute('placeholder', '0')
            counterInput1.setAttribute('data-dtype', 'Number')
            if (counter.editRole && game.user.role < counter.editRole) {
                counterInput1.classList.add('disabled')
                counterInput1.setAttribute('disabled', 'true')
            } else {
                counterInput1.addEventListener('keyup', () => checkValue(counterInput1, actor, key), true)
            }
            counterInput2.setAttribute('type', 'text')
            counterInput2.setAttribute('name', `flags.${MODULE.ID}.${key}.failure`)
            counterInput2.setAttribute('value', app.actor.getFlag(MODULE.ID, `${key}.failure`) || 0)
            counterInput2.setAttribute('placeholder', '0')
            counterInput2.setAttribute('data-dtype', 'Number')
            if (counter.editRole && game.user.role < counter.editRole) {
                counterInput2.classList.add('disabled')
                counterInput2.setAttribute('disabled', 'true')
            } else {
                counterInput2.addEventListener('keyup', () => checkValue(counterInput1, actor, key), true)
            }
            break
        }

        countersDiv[0].appendChild(counterDiv)
        counterDiv.appendChild(h4)
        counterDiv.appendChild(counterValueDiv)

        if (counter.type === 'successFailure') {
            const iSuccess = document.createElement('i')
            const iFailure = document.createElement('i')

            iSuccess.classList.add('fas', 'fa-check')
            iFailure.classList.add('fas', 'fa-times')

            counterValueDiv.appendChild(iSuccess)
            counterValueDiv.appendChild(counterInput1)
            counterValueDiv.appendChild(iFailure)
            counterValueDiv.appendChild(counterInput2)
        } else if (counter.type === 'fraction') {
            counterValueDiv.appendChild(counterInput1)
            const separator = document.createElement('span')
            separator.classList.add('sep')
            separator.textContent = '/'
            counterValueDiv.appendChild(separator)
            counterValueDiv.appendChild(counterInput2)
        } else {
            counterValueDiv.appendChild(counterInput1)
        }
    }
}
