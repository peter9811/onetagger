import { Dialog, Notify, setCssVar } from 'quasar';
import { ref, Ref } from 'vue';
import { AutotaggerConfig, AutotaggerPlatform, TaggerStatus } from './autotagger';
import { Player } from './player';
import { QTTrack, QuickTag, QuickTagFile } from './quicktag';
import { Settings } from './settings';
import { Keybind, Playlist, Spotify, wsUrl } from './utils';
import router from './router';

class OneTagger {
  // Singleton
  private static instance: OneTagger;

  info: Ref<AppInfo> = ref({}) as Ref<AppInfo>;
  config: Ref<AutotaggerConfig> = ref(new AutotaggerConfig());
  lock: Ref<{ locked: boolean }> = ref({ locked: false });
  player: Ref<Player> = ref(new Player(this));
  quickTag: Ref<QuickTag> = ref(new QuickTag());
  settings: Ref<Settings> = ref(new Settings());
  spotify: Ref<Spotify> = ref(new Spotify());
  helpDialog: Ref<{ open: boolean, route?: string }> = ref({ open: false });
  folderBrowser: Ref<FolderBrowser> = ref(new FolderBrowser());
  taggerStatus: Ref<TaggerStatus> = ref(new TaggerStatus());
  autoTaggerPlaylist: Ref<Playlist> = ref({});

  // Websocket
  private ws!: WebSocket;
  private wsPromiseResolve?: (_: any) => void;
  private wsPromise?;

  // Quicktag track loading
  private nextQTTrack?: QTTrack;

  private constructor() {
    // Singleton
    if (OneTagger.instance) {
      return OneTagger.instance;
    }
    OneTagger.instance = this;

    // WS connection promise
    this.wsPromise = new Promise((res) => this.wsPromiseResolve = res);
    // Setup WS connection
    this.ws = new WebSocket(wsUrl());
    this.ws.addEventListener('error', (e) => this.onError(e ?? 'Websocket error!'));
    this.ws.addEventListener('close', (_) => this.onError('WebSocket closed!'));
    this.ws.addEventListener('open', (_) => {
      // Resolve connection promise
      if (this.wsPromiseResolve) {
        this.wsPromiseResolve(null);
        this.wsPromiseResolve = undefined;
      }

      // Load initial data
      this.send('loadSettings');
      setTimeout(() => {
        this.send('init');
        this.send('spotifyAuthorized');
        // Update custom to v2
        this.send('defaultCustomPlatformSettings');
      }, 100);
    });
    this.ws.addEventListener('message', (event) => {
      // Parse incoming message
      let json = JSON.parse(event.data);
      if (!json.action) return;
      this.incomingEvent(json);
    });

    // Keybinds
    document.addEventListener('keydown', (e) => {
      // Can be safely error ignored
      // @ts-ignore
      if (e.target && e.target.nodeName === 'INPUT') return true;

      if (this.handleKeyDown(e)) {
        e.preventDefault();
        return false;
      }
    });
  }

  // SHOULD BE OVERWRITTEN
  quickTagUnfocus() {}
  onTaggingDone(_: any) {}
  onQuickTagEvent(_: any, __?: any) {}
  onQuickTagBrowserEvent(_: any) {}
  onTagEditorEvent(_: any) {}
  onAudioFeaturesEvent(_: any) {}
  onRenamerEvent(_: any) {}
  onFolderBrowserEvent(_: any) {}
  // =======================

  // Display error message
  private onError(error: string) {
    Notify.create({ color: 'negative', message: error, icon: 'error' });
  }

  // Sends an action to the WebSocket server
  private send(action: string, params?: any) {
    this.wsPromise.then(() => {
      this.ws.send(JSON.stringify({ action, params }));
    });
  }

  // Processes incoming events from the WebSocket server
  private incomingEvent(event: any) {
    switch (event.action) {
      case 'newVersion': {
        this.info.value.version = event.data;
        break;
      }
      case 'lock': {
        this.lock.value.locked = event.data;
        break;
      }
      case 'error': {
        this.onError(event.data);
        break;
      }
      case 'loadedSettings': {
        this.settings.value.load(event.data);
        this.setTheme();
        break;
      }
      case 'loadedProfiles': {
        this.config.value.loadProfiles(event.data);
        break;
      }
      case 'loadedTracks': {
        this.autoTaggerPlaylist.value.tracks = event.data.tracks;
        break;
      }
      case 'settingsUpdated': {
        this.settings.value.update(event.data);
        this.setTheme();
        break;
      }
      case 'taggingDone': {
        this.onTaggingDone(event.data);
        break;
      }
      case 'quickTagEvent': {
        this.onQuickTagEvent(event.data.event, event.data.value);
        break;
      }
      case 'quickTagBrowserEvent': {
        this.onQuickTagBrowserEvent(event.data);
        break;
      }
      case 'tagEditorEvent': {
        this.onTagEditorEvent(event.data);
        break;
      }
      case 'audioFeaturesEvent': {
        this.onAudioFeaturesEvent(event.data);
        break;
      }
      case 'renamerEvent': {
        this.onRenamerEvent(event.data);
        break;
      }
      case 'folderBrowserEvent': {
        this.onFolderBrowserEvent(event.data);
        break;
      }
    }
  }

  // Sets the theme based on the selected theme in settings
  private setTheme() {
    const theme = this.settings.value.get('theme') || 'auto';
    setCssVar('primary', theme === 'auto' ? '#1976D2' : theme);
  }

  // Handles keydown events
  private handleKeyDown(event: KeyboardEvent) {
    const keybind = Keybind.fromEvent(event);
    if (!keybind) return false;

    switch (keybind.action) {
      case 'openFile': {
        this.quickTag.value.showOpenFile();
        break;
      }
      case 'openFolder': {
        this.quickTag.value.showOpenFolder();
        break;
      }
      case 'openFolderBrowser': {
        this.showFolderBrowser();
        break;
      }
      case 'saveSettings': {
        this.saveSettings();
        break;
      }
      case 'loadSettings': {
        this.loadSettings();
        break;
      }
      case 'loadProfile': {
        this.quickTag.value.loadProfile(keybind.payload);
        break;
      }
      case 'saveProfile': {
        this.quickTag.value.saveProfile(keybind.payload);
        break;
      }
      case 'loadTrack': {
        this.quickTag.value.loadTrack(keybind.payload);
        break;
      }
      case 'saveTrack': {
        this.quickTag.value.saveTrack(keybind.payload);
        break;
      }
      case 'toggleSidebar': {
        this.toggleSidebar();
        break;
      }
      case 'toggleHelp': {
        this.toggleHelp();
        break;
      }
      case 'toggleLock': {
        this.toggleLock();
        break;
      }
      case 'toggleAutoTagger': {
        this.toggleAutoTagger();
        break;
      }
      case 'toggleTagEditor': {
        this.quickTag.value.toggleTagEditor();
        break;
      }
      case 'tagNext': {
        this.quickTag.value.tagNext();
        break;
      }
      case 'tagPrev': {
        this.quickTag.value.tagPrev();
        break;
      }
      case 'quickTagAction': {
        this.quickTag.value.performAction(keybind.payload);
        break;
      }
      case 'quickTagBrowserAction': {
        this.quickTag.value.performBrowserAction(keybind.payload);
        break;
      }
      case 'tagEditorAction': {
        this.quickTag.value.performTagEditorAction(keybind.payload);
        break;
      }
      case 'audioFeaturesAction': {
        this.quickTag.value.performAudioFeaturesAction(keybind.payload);
        break;
      }
      case 'renamerAction': {
        this.quickTag.value.performRenamerAction(keybind.payload);
        break;
      }
      case 'folderBrowserAction': {
        this.folderBrowser.value.performAction(keybind.payload);
        break;
      }
      default: {
        return false;
      }
    }

    return true;
  }

  // Toggles the sidebar
  private toggleSidebar() {
    Dialog.set({
      component: import('./components/Sidebar.vue'),
      transitionShow: 'slide-right',
      transitionHide: 'slide-right',
    }).then((dialog) => dialog.toggle());
  }

  // Toggles the help dialog
  private toggleHelp(route?: string) {
    if (this.helpDialog.value.open && this.helpDialog.value.route === route) {
      this.helpDialog.value.open = false;
      return;
    }

    this.helpDialog.value.open = true;
    this.helpDialog.value.route = route;
  }

  // Toggles the lock status
  private toggleLock() {
    this.lock.value.locked = !this.lock.value.locked;
    this.send('toggleLock', this.lock.value.locked);
  }

  // Toggles the Auto Tagger feature
  private toggleAutoTagger() {
    this.taggerStatus.value.enabled = !this.taggerStatus.value.enabled;
    this.send('toggleAutoTagger', this.taggerStatus.value.enabled);
  }

  // Shows the folder browser
  private showFolderBrowser() {
    Dialog.set({
      component: import('./components/FolderBrowser.vue'),
      transitionShow: 'slide-right',
      transitionHide: 'slide-right',
    }).then((dialog) => dialog.toggle());
  }

  // Saves the current settings
  private saveSettings() {
    this.send('saveSettings', this.settings.value.export());
  }

  // Loads the saved settings
  private loadSettings() {
    this.send('loadSettings');
  }

  // Singleton instance getter
  static getInstance(): OneTagger {
    return OneTagger.instance || new OneTagger();
  }
}

export default OneTagger.getInstance();
