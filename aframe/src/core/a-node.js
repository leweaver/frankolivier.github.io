/* global HTMLElement, MutationObserver */
var registerElement = require('./a-register-element').registerElement;
var utils = require('../utils/');

var bind = utils.bind;
var warn = utils.debug('core:a-node:warn');

/**
 * Base class for A-Frame that manages loading of objects.
 *
 * Nodes can be modified using mixins.
 * Nodes emit a `loaded` event when they and their children have initialized.
 */
module.exports = registerElement('a-node', {
  prototype: Object.create(HTMLElement.prototype, {
    createdCallback: {
      value: function () {
        this.hasLoaded = false;
        this.isNode = true;
        this.mixinEls = [];
        this.mixinObservers = {};
      },
      writable: window.debug
    },

    attachedCallback: {
      value: function () {
        var mixins;
        this.sceneEl = this.closestScene();

        if (!this.sceneEl) {
          warn('You are attempting to attach <' + this.tagName + '> outside of an A-Frame ' +
               'scene. Append this element to `<a-scene>` instead.');
        }

        this.hasLoaded = false;
        this.emit('nodeready', {}, false);

        mixins = this.getAttribute('mixin');
        if (mixins) { this.updateMixins(mixins); }
      },
      writable: window.debug
    },

    attributeChangedCallback: {
      value: function (attr, oldVal, newVal) {
        if (attr === 'mixin') { this.updateMixins(newVal, oldVal); }
      }
    },

   /**
    * Returns the first scene by traversing up the tree starting from and
    * including receiver element.
    */
    closestScene: {
      value: function closest () {
        var element = this;
        while (element) {
          if (element.isScene) { break; }
          element = element.parentElement;
        }
        return element;
      }
    },

    /**
     * Returns first element matching a selector by traversing up the tree starting
     * from and including receiver element.
     *
     * @param {string} selector - Selector of element to find.
     */
    closest: {
      value: function closest (selector) {
        var matches = this.matches || this.mozMatchesSelector ||
          this.msMatchesSelector || this.oMatchesSelector || this.webkitMatchesSelector;
        var element = this;
        while (element) {
          if (matches.call(element, selector)) { break; }
          element = element.parentElement;
        }
        return element;
      }
    },

    detachedCallback: {
      value: function () {
        this.hasLoaded = false;
      }
    },

    /**
     * Wait for children to load, if any.
     * Then emit `loaded` event and set `hasLoaded`.
     */
    load: {
      value: function (cb, childFilter) {
        var children;
        var childrenLoaded;
        var self = this;

        if (this.hasLoaded) { return; }

        // Default to waiting for all nodes.
        childFilter = childFilter || function (el) { return el.isNode; };

        // Wait for children to load (if any), then load.
        children = this.getChildren();
        childrenLoaded = children.filter(childFilter).map(function (child) {
          return new Promise(function waitForLoaded (resolve) {
            if (child.hasLoaded) { return resolve(); }
            child.addEventListener('loaded', resolve);
          });
        });

        Promise.all(childrenLoaded).then(function emitLoaded () {
          self.hasLoaded = true;
          if (cb) { cb(); }
          self.emit('loaded', {}, false);
        });
      },
      writable: true
    },

    getChildren: {
      value: function () {
        return Array.prototype.slice.call(this.children, 0);
      }
    },

    updateMixins: {
      value: function (newMixins, oldMixins) {
        var newMixinsIds = newMixins.split(' ');
        var oldMixinsIds = oldMixins ? oldMixins.split(' ') : [];
        // To determine what listeners will be removed
        var diff = oldMixinsIds.filter(function (i) { return newMixinsIds.indexOf(i) < 0; });
        this.mixinEls = [];
        diff.forEach(bind(this.unregisterMixin, this));
        newMixinsIds.forEach(bind(this.registerMixin, this));
      }
    },

    registerMixin: {
      value: function (mixinId) {
        if (!this.sceneEl) { return; }
        var mixinEl = this.sceneEl.querySelector('a-mixin#' + mixinId);
        if (!mixinEl) { return; }
        this.attachMixinListener(mixinEl);
        this.mixinEls.push(mixinEl);
      }
    },

    setAttribute: {
      value: function (attr, newValue) {
        if (attr === 'mixin') { this.updateMixins(newValue); }
        HTMLElement.prototype.setAttribute.call(this, attr, newValue);
      }
    },

    unregisterMixin: {
      value: function (mixinId) {
        var mixinEls = this.mixinEls;
        var mixinEl;
        var i;
        for (i = 0; i < mixinEls.length; ++i) {
          mixinEl = mixinEls[i];
          if (mixinId === mixinEl.id) {
            mixinEls.splice(i, 1);
            break;
          }
        }
        this.removeMixinListener(mixinId);
      }
    },

    removeMixinListener: {
      value: function (mixinId) {
        var observer = this.mixinObservers[mixinId];
        if (!observer) { return; }
        observer.disconnect();
        this.mixinObservers[mixinId] = null;
      }
    },

    attachMixinListener: {
      value: function (mixinEl) {
        var self = this;
        var mixinId = mixinEl.id;
        var currentObserver = this.mixinObservers[mixinId];
        if (!mixinEl) { return; }
        if (currentObserver) { return; }
        var observer = new MutationObserver(function (mutations) {
          var attr = mutations[0].attributeName;
          self.handleMixinUpdate(attr);
        });
        var config = { attributes: true };
        observer.observe(mixinEl, config);
        this.mixinObservers[mixinId] = observer;
      }
    },

    handleMixinUpdate: {
      value: function () { /* no-op */ }
    },

    /**
     * Emits a DOM event.
     *
     * @param {String} name
     *   Name of event (use a space-delimited string for multiple events).
     * @param {Object=} [detail={}]
     *   Custom data to pass as `detail` to the event.
     * @param {Boolean=} [bubbles=true]
     *   Whether the event should bubble.
     */
    emit: {
      value: function (name, detail, bubbles) {
        var self = this;
        detail = detail || {};
        if (bubbles === undefined) { bubbles = true; }
        var data = { bubbles: !!bubbles, detail: detail };
        return name.split(' ').map(function (eventName) {
          return utils.fireEvent(self, eventName, data);
        });
      }
    },

    /**
     * Returns a closure that emits a DOM event.
     *
     * @param {String} name
     *   Name of event (use a space-delimited string for multiple events).
     * @param {Object} detail
     *   Custom data (optional) to pass as `detail` if the event is to
     *   be a `CustomEvent`.
     * @param {Boolean} bubbles
     *   Whether the event should be bubble.
     */
    emitter: {
      value: function (name, detail, bubbles) {
        var self = this;
        return function () {
          self.emit(name, detail, bubbles);
        };
      }
    }
  })
});