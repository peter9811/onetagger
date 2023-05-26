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
  private wsPromise?: Promise<any>;

  // Quicktag track loading
  private nextQTTrack?: QTTrack;

  private constructor() {
    // Singleton
    if (OneTagger.instance) {
      return OneTagger.instance;
    }
    OneTagger.instance = this;

    // WS connection promise
    this.wsPromise = new Promise((res) => (this.wsPromiseResolve = res));
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
      if (e.target && e.target.nodeName == 'INPUT') return true;

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

  private async incomingEvent(e: IncomingEvent) {
    switch (e.action) {
      case 'settings': {
        await this.settings.value.load(e.settings);
        break;
      }
      case 'loadProfiles': {
        this.config.value.loadProfiles(e.profiles);
        break;
      }
      case 'player': {
        this.player.value.update(e);
        break;
      }
      case 'spotify': {
        this.spotify.value.update(e);
        break;
      }
      case 'quickTag': {
        this.quickTag.value.update(e);
        break;
      }
      case 'quickTagFiles': {
        if (!this.quickTag.value.tracks.length) {
          Notify.create('Error: Can not add files to QuickTag without tracks');
          break;
        }
        for (const file of e.files) {
          this.quickTag.value.addTrack(new QuickTagFile(file));
        }
        break;
      }
      case 'taggerStatus': {
        this.taggerStatus.value.update(e);
        break;
      }
      case 'autoTaggerPlaylist': {
        this.autoTaggerPlaylist.value = e.playlist;
        break;
      }
      case 'locked': {
        this.lock.value.locked = e.locked;
        break;
      }
      case 'notify': {
        Notify.create({
          type: e.notify.type ?? 'info',
          message: e.notify.message,
        });
        break;
      }
      case 'error': {
        this.onError(e.error);
        break;
      }
      case 'autoTaggerPlatform': {
        this.config.value.updatePlatform(e.platform, e.platformIndex);
        break;
      }
    }
  }

  private handleKeyDown(e: KeyboardEvent): boolean {
    if (e.target && e.target.nodeName === 'INPUT') return false;

    if (e.code === 'KeyP' && (e.ctrlKey || e.metaKey)) {
      this.player.value.togglePlayback();
      return true;
    }

    return false;
  }

  private send(action: string, params?: any) {
    this.wsPromise?.then(() => {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ action, ...params }));
      } else {
        this.onError('WebSocket is not open!');
      }
    });
  }

  private onError(error: any) {
    Dialog.create({
      title: 'Error',
      message: typeof error === 'string' ? error : 'An error occurred.',
      ok: 'Close',
    });
  }

  static getInstance(): OneTagger {
    if (!OneTagger.instance) {
      OneTagger.instance = new OneTagger();
    }
    return OneTagger.instance;
  }
}

export default OneTagger;
