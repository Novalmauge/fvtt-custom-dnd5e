import { MODULE } from '../constants.js';

export class MyApplication extends Application {
    // Implementing the life-cycle method for preRender
    async _preRender(force = false, options = {}) {
        // Do not render under certain conditions
        const states = Application.RENDER_STATES;
        this._priorState = this._state;
        if ([states.CLOSING, states.RENDERING].includes(this._state)) return;

        // Applications which are not currently rendered must be forced
        if (!force && (this._state <= states.NONE)) return;

        // Begin rendering the application
        if ([states.NONE, states.CLOSED, states.ERROR].includes(this._state)) {
            console.log(`${MODULE.ID} | Rendering ${this.constructor.name}`);
        }
        this._state = states.RENDERING;

        // Merge provided options with those supported by the Application class
        foundry.utils.mergeObject(this.options, options, { insertKeys: false });
        options.focus ??= force;

        // Get the existing HTML element and application data used for rendering
        const element = this.element;
        const data = await this.getData(this.options);

        // Call hooks for all classes in the inheritance chain
        for (const cls of this.constructor._getInheritanceChain()) {
            Hooks.callAll(`preRender${cls.name}`, this, data);
        }

        // Store scroll positions
        if (element.length && this.options.scrollY) this._saveScrollPositions(element);

        // Render the inner content
        const inner = await this._renderInner(data);
        let html = inner;

        // Call hooks for rendering inner content
        for (const cls of this.constructor._getInheritanceChain()) {
            Hooks.callAll(`renderInner${cls.name}`, this, html, data);
        }

        // If the application already exists in the DOM, replace the inner content
        if (element.length) this._replaceHTML(element, html);
        // Otherwise render a new app
        else {
            // Wrap a popOut application in an outer frame
            if (this.popOut) {
                html = await this._renderOuter();
                html.find('.window-content').append(inner);
                ui.windows[this.appId] = this;
            }

            // Add the HTML to the DOM and record the element
            this._injectHTML(html);
        }

        if (!this.popOut && this.options.resizable) new Draggable(this, html, false, this.options.resizable);

        // Activate event listeners on the inner HTML
        this._activateCoreListeners(inner);
        this.activateListeners(inner);

        // Set the application position (if it's not currently minimized)
        if (!this._minimized) {
            foundry.utils.mergeObject(this.position, options, { insertKeys: false });
            this.setPosition(this.position);
        }

        // Apply focus to the application, maximizing it and bringing it to the top
        if (this.popOut && (options.focus === true)) this.maximize().then(() => this.bringToTop());

        // Dispatch Hooks for rendering the base and subclass applications
        for (const cls of this.constructor._getInheritanceChain()) {
            Hooks.callAll(`render${cls.name}`, this, html, data);
        }

        // Restore prior scroll positions
        if (this.options.scrollY) this._restoreScrollPositions(html);
        this._state = states.RENDERED;
    }

    // Implement the onRender hook
    async _onRender() {
        // Custom logic for after the render process
        console.log(`${MODULE.ID} | onRender ${this.constructor.name}`);
        // Example: Update UI elements, handle post-render events, etc.
    }

    // Implement the onClose hook
    async _onClose() {
        // Custom logic for when the application is closed
        console.log(`${MODULE.ID} | onClose ${this.constructor.name}`);
        // Example: Cleanup resources, save state, etc.
    }

    // Other life-cycle methods can be implemented similarly
}

// Register hooks for all instances of MyApplication
Hooks.on('preRenderMyApplication', (app, data) => {
    // Example: Modify data before rendering
    console.log('preRender hook for MyApplication', app, data);
    // Example: Add additional pre-render logic here
});

Hooks.on('renderMyApplication', (app, html, data) => {
    // Example: Perform actions after the application is rendered
    console.log('render hook for MyApplication', app, html, data);
    // Example: Add additional render logic here
});

Hooks.on('closeMyApplication', (app) => {
    // Example: Perform cleanup actions when the application is closed
    console.log('close hook for MyApplication', app);
    // Example: Add additional close logic here
});
