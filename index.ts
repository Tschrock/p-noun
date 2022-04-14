type Entry = [
    subject: string | symbol,
    object: string | symbol,
    possessiveAdjective?: string | symbol,
    possessivePronoun?: string | symbol,
    reflexive?: string | symbol,
];


const ORIGINAL = Symbol("original")
const NAME = Symbol("name")

const pronouns: Record<string, Entry> = {
    "ae": ["ae", "aer", "aer", "aers", "aerself"],
    "ey": ["ey", "em", "eir", "eirs", "emself"],
    "fae": ["fae", "faer", "faer", "faers", "faerself"],
    "he": ["he", "him", "his", "his", "himself"],
    "it": ["it", "it", "it", "its", "itself"],
    "ne": ["ne", "nem", "nir", "nirs", "nemself"],
    "per": ["per", "per", "pers", "pers", "perself"],
    "she": ["she", "her", "her", "hers", "herself"],
    "sie": ["sie", "sir", "hir", "hirs", "hirself"],
    "they": ["they", "them", "their", "theirs", "themself"],
    "ve": ["ve", "ver", "vis", "vers", "verself"],
    "xe": ["xe", "xem", "xyr", "xyrs", "xemself"],
    "ze": ["ze", "hir", "hir", "hirs", "hirself"],
    "ze2": ["ze", "zir", "zir", "zirs", "zirself"],
    "zie": ["zie", "zim", "zir", "zirs", "zirself"],
    "unknown": [ORIGINAL, ORIGINAL, ORIGINAL, ORIGINAL, ORIGINAL],
    "any": [ORIGINAL, ORIGINAL, ORIGINAL, ORIGINAL, ORIGINAL],
    "none": [NAME, NAME, NAME, NAME, NAME],
}

const pronounDbMap: Record<string, string> = {
    "unspecified": "unknown",
    "hh": "he",
    "hi": "he",
    "hs": "he",
    "ht": "he",
    "ih": "it",
    "ii": "it",
    "is": "it",
    "it": "it",
    "shh": "she",
    "sh": "she",
    "si": "she",
    "st": "she",
    "th": "they",
    "ti": "they",
    "ts": "they",
    "tt": "they",
    "any": "any",
    "other": "unknown",
    "ask": "unknown",
    "avoid": "none",
}

function lookupPronouns(value: string): Entry | undefined {
    const mapped = pronounDbMap[value];
    return mapped ? pronouns[mapped] : pronouns[value];
}

const ENTRY_FORMATS = ["s", "o", "pa", "pp", "r"];
const PRONOUN_FORMATS = ["n", "np", "nr", ...ENTRY_FORMATS];
type EntryFormat = "s" | "o" | "pa" | "pp" | "r";
type PronounFormat = "n" | "np" | "nr" | EntryFormat;


type NotifyFn = (oldElement?: PIdElement, newElement?: PIdElement) => void;

class RefManager {
    private refMap = new Map<string, Set<PIdElement>>();
    private listenerMap = new Map<string, Set<NotifyFn>>();

    public add(ref: string, el: PIdElement) {
        let refs = this.refMap.get(ref);
        if (refs) {
            refs.add(el);
        }
        else {
            this.refMap.set(ref, new Set([el]));
            queueMicrotask(() => this.notify(ref, undefined, el));
        }
    }

    public remove(ref: string, el: PIdElement) {
        let refs = this.refMap.get(ref);
        if (refs) {
            const first = this.get(ref) === el;
            refs.delete(el);
            if (!refs.size) this.refMap.delete(ref);
            if (first) {
                const newEl = this.get(ref);
                queueMicrotask(() => this.notify(ref, el, newEl));
            }
        }
    }

    public on(ref: string, fn: NotifyFn) {
        let listeners = this.listenerMap.get(ref);
        if (listeners) {
            listeners.add(fn);
        }
        else {
            this.listenerMap.set(ref, new Set([fn]));
        }
        const el = this.get(ref);
        queueMicrotask(() => fn(undefined, el));
    }

    public off(ref: string, fn: NotifyFn) {
        let listeners = this.listenerMap.get(ref);
        if (listeners) {
            listeners.delete(fn);
            if (!listeners.size) this.listenerMap.delete(ref);
        }
    }

    private get(ref: string): PIdElement | undefined {
        let refs = this.refMap.get(ref);
        return refs && refs.values().next().value;
    }

    private notify(ref: string, oldElement?: PIdElement, newElement?: PIdElement) {
        let listeners = this.listenerMap.get(ref);
        if (listeners) {
            listeners.forEach(fn => fn(oldElement, newElement));
        }
    }
}

const REF_MANAGER = Symbol("ref manager");

interface Document { [REF_MANAGER]?: RefManager; }

interface Gender {
    pronouns: Entry
}

interface PronounDb {
    pronouns: string;
}

class AbortControllerMux extends AbortController {
    private _count = 1;
    abort(reason?: any) {
        this._count--;
        if (this._count <= 0) {
            super.abort(reason);
        }
    }
    bump() {
        this._count++;
    }
}

class AbortedGenderError extends Error { }

class GenderCache {
    private genderRequests = new Map<string, [Promise<Gender>, AbortControllerMux]>();
    public fetch(uri: string, signal: AbortSignal): Promise<Gender> {
        let [promise, abortMux] = this.genderRequests.get(uri) ?? [];
        if (promise && abortMux) {
            abortMux.bump();
            return promise;
        }
        else {
            const abortMux = new AbortControllerMux();
            const abortPromise = new Promise<Gender>((_, reject) => signal.addEventListener("abort", () => {
                abortMux.abort();
                reject(new DOMException("Request was aborted", "AbortError"));
            }));
            promise = fetch(uri, {
                method: 'GET',
                credentials: 'omit',
                mode: 'cors',
                redirect: 'follow',
                referrerPolicy: 'no-referrer',
                signal: abortMux.signal
            }).then(
                async response => {
                    if (response.ok) {
                        const data = await response.json();
                        if ('pronouns' in data) {
                            const respPronouns = data.pronouns;
                            if (typeof respPronouns === 'string') {
                                const pronouns = lookupPronouns(respPronouns);
                                if (pronouns) {
                                    return { pronouns };
                                }
                            }
                            else if (Array.isArray(respPronouns) && respPronouns.length >= 2 && respPronouns.every(p => typeof p === "string")) {
                                return { pronouns: respPronouns as [string, string, string] };
                            }
                        }
                        throw new Error("Unknown gender format.");
                    }
                    throw new Error(`Gender http response status indicates an error: ${response.status}: ${response.statusText}`);
                }
            );
            this.genderRequests.set(uri, [promise, abortMux]);
            return Promise.race([promise, abortPromise]);
        }
    }
}

const defaultGenderCache = new GenderCache();

interface PronounData {
    identity: string,
    pronouns?: Entry,
}


function changeGender(form: PronounFormat, data: PronounData, fallback: string): string {
    switch (form) {
        case "n":
        case "np":
        case "nr":
            return getIdentityInForm(form, data.identity);
        default:
            return getPronounInForm(form, data, fallback);
    }
}

function getPronounInForm(form: EntryFormat, data: PronounData, fallback: string): string {
    if (data.pronouns) {
        const formIndex = ENTRY_FORMATS.indexOf(form);
        if (formIndex != -1) {
            const pronoun = data.pronouns[formIndex];
            if (typeof pronoun === "string") {
                if (/^\p{Lu}/u.test(fallback)) {
                    return pronoun[0].toUpperCase() + pronoun.substring(1)
                } else {
                    return pronoun;
                }
            } else {
                if (pronoun === ORIGINAL) return fallback;
                if (pronoun === NAME) return getIdentityInForm(form, data.identity);
            }
        }
    }
    return fallback;
}

function getIdentityInForm(form: PronounFormat, identity: string): string {
    switch (form) {
        case "np":
        case "pa":
        case "pp":
            return identity + "'s";
        case "nr":
        case "r":
            return identity + "'s self";
        default:
            return identity;
    }
}

function inferForm(pronoun: string): EntryFormat | undefined {
    pronoun = pronoun.toLowerCase();
    const options = Object.values(pronouns).map(p => p.indexOf(pronoun)).filter(i => i !== -1);
    return options.length === 1 ? ENTRY_FORMATS[options[0]] as EntryFormat : undefined;
}

class PNounElement extends HTMLElement {
    private _ref: string = "";
    private mutationObserver?: MutationObserver;

    public get ref() {
        return this._ref;
    }

    public set ref(value) {
        const oldRef = this.getAttribute('ref');
        this.setAttribute('ref', value);
    }

    private _form: string = "";

    public get form() {
        return PRONOUN_FORMATS.includes(this._form) ? this._form : null;
    }

    public set form(value) {
        if (!value || !PRONOUN_FORMATS.includes(value)) {
            throw new RangeError("Invalid format");
        }
        this.setAttribute('form', value);
    }

    static get observedAttributes() {
        return ['ref', 'form'];
    }

    attributeChangedCallback(name: string, oldValue: string, newValue: string) {
        switch (name) {
            case 'ref':
                this._ref = newValue;
                if (oldValue) {
                    this.refManager.off(oldValue, this.onReferencedElementChangedFn);
                }
                if (newValue && this.isConnected) {
                    this.refManager.on(newValue, this.onReferencedElementChangedFn);
                }
                break;
            case 'form':
                this._form = newValue;
                this.updatePronouns();
                break;
        }
    }

    connectedCallback() {
        this._value = this._fallback = this.innerText;
        if (this.isConnected) {
            if (this._ref) {
                this.refManager.on(this._ref, this.onReferencedElementChangedFn);
            }

            this.mutationObserver && this.mutationObserver.disconnect();
            if(!this._fallback) {
                this.mutationObserver = new MutationObserver(mutations => {
                    if(mutations.some(m => m.type !== 'attributes')) {
                        this._fallback = this.innerText;
                        this.mutationObserver && this.mutationObserver.disconnect();
                        this.mutationObserver = undefined;
                        queueMicrotask(() => this.updatePronouns());
                    }
                });
                this.mutationObserver.observe(this, { childList: true });
            }
        }
    }
    disconnectedCallback() {
        if (!this.isConnected) {
            this.refManager.off(this._ref, this.onReferencedElementChangedFn);
            this.mutationObserver && this.mutationObserver.disconnect();
            this.mutationObserver = undefined;
        }
    }

    private _fallback: string = "";

    public get fallback() {
        return this._fallback;
    }

    public set fallback(value) {
        this._fallback = value;
    }

    private _value: string = "";

    public get value() {
        return this._value;
    }

    public set value(value) {
        this._value = value;
    }

    private get refManager(): RefManager {
        let manager = this.ownerDocument[REF_MANAGER];
        if (!manager) manager = this.ownerDocument[REF_MANAGER] = new RefManager();
        return manager;
    }

    constructor() {
        super();
    }

    private onReferencedElementChangedFn = this.onReferencedElementChanged.bind(this);
    private onReferencedElementChanged(oldElement?: PIdElement, newElement?: PIdElement) {
        if (oldElement) oldElement.removeEventListener("genderupdated", this.onGenderChangedFn);
        if (newElement) {
            this.pronounData = newElement.pronounData;
            this.updatePronouns();
            newElement.addEventListener("genderupdated", this.onGenderChangedFn);
        }
    }

    private onGenderChangedFn = this.onGenderChanged.bind(this);
    private onGenderChanged(event: Event) {
        this.pronounData = (event as CustomEvent<PronounData>).detail;
        this.updatePronouns();
    }

    private pronounData?: PronounData;

    private updatePronouns() {
        if(this.isConnected) {
            const form = this._form || inferForm(this._fallback);
            if (form && this.pronounData) {
                this.value = this.innerText = changeGender(form as PronounFormat, this.pronounData, this._fallback);
            } else {
                this.value = this.innerText = this._fallback;
            }
        }
    }
}

window.customElements.define('p-noun', PNounElement);

class PIdElement extends HTMLElement {
    private _ref: string = "";
    private mutationObserver?: MutationObserver;

    public get ref() {
        return this._ref;
    }

    public set ref(value) {
        this.setAttribute('ref', value);
    }

    private _src: string = "";

    public get src() {
        return this._src;
    }

    public set src(value) {
        this.setAttribute('src', value);;
    }

    static get observedAttributes() {
        return ['ref', 'src'];
    }

    private _value: string = "";

    private setValue(value: string) {
        if(this._value !== value) {
            this._value = value;
            this.dispatchEvent(new CustomEvent("genderupdated", { detail: this.pronounData }));
        }
        return value;
    }

    public get value() {
        return this._value;
    }

    public set value(value) {
        this.innerText = this.setValue(value);
    }

    attributeChangedCallback(name: string, oldValue: string, newValue: string) {
        switch (name) {
            case 'ref':
                this._ref = newValue;
                if (oldValue) {
                    this.refManager.remove(oldValue, this);
                }
                if (this.isConnected && newValue) {
                    this.refManager.add(newValue, this);
                }
                break;
            case 'src':
                this._src = newValue;
                if (this._src) {
                    queueMicrotask(() => this._loadGender(this._src));
                }
                break;
        }
    }

    connectedCallback() {
        if (this.isConnected) {
            this.setValue(this.innerText);
            if (this._ref) {
                this.refManager.add(this._ref, this);
            }
            this.mutationObserver && this.mutationObserver.disconnect();
            this.mutationObserver = new MutationObserver(mutations => {
                if(mutations.some(m => m.type !== 'attributes')) {
                    this.setValue(this.innerText);
                }
            });
            this.mutationObserver.observe(this, { childList: true });
        }
    }

    disconnectedCallback() {
        if(!this.isConnected) {
            this._ref && this.refManager.remove(this._ref, this);
            this.mutationObserver && this.mutationObserver.disconnect();
            this.mutationObserver = undefined;
        }
    }

    private get refManager(): RefManager {
        let manager = this.ownerDocument[REF_MANAGER];
        if (!manager) manager = this.ownerDocument[REF_MANAGER] = new RefManager();
        return manager;
    }

    private _abortController?: AbortController;

    constructor() {
        super();
    }

    private loadedPronouns?: Entry;

    public get pronounData() {
        return {
            identity: this._value,
            pronouns: this.loadedPronouns,
        }
    }

    private _loadGender(src: string) {
        this._cancelGender();
        const colonIndex = src.indexOf(":");
        if (colonIndex === -1) {
            // constant gender
            const gender = lookupPronouns(src) ?? pronouns["unknown"];
            this.loadedPronouns = gender;
            this.dispatchEvent(new CustomEvent("genderupdated", { detail: this.pronounData }));
        }
        else {
            // load gender
            const provider = src.slice(0, colonIndex);
            if (!provider) {
                this._emitGenderError(new Error(`Unknown gender source '${src}'.`));
            }

            this._abortController = new AbortController();
            defaultGenderCache.fetch(src, this._abortController.signal).then(
                gender => {
                    this.loadedPronouns = gender.pronouns;
                    this.dispatchEvent(new CustomEvent("genderupdated", { detail: this.pronounData }));
                },
                error => {
                    if (error instanceof DOMException && error.name === "AbortError") {
                        // ignore
                    }
                    else {
                        this._emitGenderError(error);
                    }
                }
            );
        }
    }

    private _cancelGender() {
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = undefined;
        }
    }

    private _emitGenderError(error: Error) {
        this.dispatchEvent(new ErrorEvent("error", { cancelable: false, error }))
    }
}

window.customElements.define('p-id', PIdElement);
