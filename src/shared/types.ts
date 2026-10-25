import type { UpdateStatus } from './update'
import type { TransferStatus } from './transfer'
import type { NetworkSettings, NetworkStatus } from './network'
export type Language = 'en' | 'vi'
export type MediaType = 'movie' | 'tv'
export type SubtitlePhase = 'pending' | 'searching' | 'needsConfiguration' | 'needsSelection' | 'complete' | 'notFound' | 'failed'
export interface Movie { id: string; title: string; searchTitle: string; year: string; genre: string; overview: string; poster?: string; mediaType?: MediaType; season?: number; episode?: number }
export interface TorrentSource { id: string; name: string; kind: 'archive' | 'pirateBay' | 'torznab' | 'x1337'; endpoint: string; enabled: boolean }
export interface SubtitleSource { id: string; name: string; kind: 'subdl' | 'subsource'; endpoint: string; enabled: boolean }
export interface Settings { interfaceLanguage: Language; appearance: 'system' | 'light' | 'dark'; downloadDirectory: string; quality: string; languages: Language[]; autoSubtitles: boolean; autoAlignSubtitles: boolean; torrentSources: TorrentSource[]; subtitleSources: SubtitleSource[]; catalogRegion: string; network?: NetworkSettings }
export interface TorrentVideo { index: number; path: string; size: number; downloaded: number; completed: boolean; season?: number; episode?: number }
export interface TVSeason { number: number; name: string; episodeCount: number }
export interface TVEpisode { number: number; name: string; airDate?: string }
export interface EngineSnapshot { id: string; name: string; progress: number; downloadRate: number; downloaded: number; uploaded: number; total: number; peers: number; paused: boolean; finished: boolean; metadata: boolean; state: number; error: string; videoPath: string; videos?: TorrentVideo[] }
export interface Alignment { accepted: boolean; score: number; offset: number; scale: number }
export interface Job { id: string; title: string; year: string; uri: string; sourceURI: string; directory: string; createdAt: number; paused: boolean; completed: boolean; videoPath: string; subtitlePhase: SubtitlePhase; subtitleLanguages: Language[]; subtitleError: string; engineError: string; subtitleSearchTitle?: string; subtitleNextAttempt?: number; subtitleAlignment?: Partial<Record<Language, Alignment>>; subtitleTimingError?: string; engine?: EngineSnapshot; mediaType?: MediaType; season?: number; episode?: number; torrentID?: string; episodes?: Job[] }
export interface Release { id: string; title: string; uri: string; size: number; seeds?: number; source: string; sourceID?: string }
export interface SubtitleMatch { id: string; fileID: number; sourceID: string; source: string; language: Language; release: string; fileName: string; hashMatch: boolean; confidence: number; downloadURL?: string }
export interface SavedState { version: number; settings: Settings; jobs: Job[] }
export interface AppState extends SavedState { syncing: boolean; subtitleBusy: string[]; aligning: string[]; credentialStatus: Record<string, boolean>; sourceTests: Record<string, string>; engineReady: boolean; notice?: string }
export interface CatalogRequest { type: MediaType; query: string; page: number; region: string; provider: number }
export interface CatalogPage { movies: Movie[]; hasMore: boolean; attribution: string }
export interface Provider { id: number; name: string }
export interface SubtitleCue { start: number; end: number; text: string }
export interface Preview { url: string; duration: number; transcoded: boolean }
export interface CommandMap {
  updateStatus: { input: undefined; output: UpdateStatus }
  checkUpdates: { input: undefined; output: UpdateStatus }
  installUpdate: { input: undefined; output: UpdateStatus }
  transferStatus: { input: undefined; output: TransferStatus }
  startTransfer: { input: undefined; output: TransferStatus }
  stopTransfer: { input: undefined; output: TransferStatus }
  pairTransfer: { input: undefined; output: TransferStatus }
  revokeTransfer: { input: { id: string }; output: TransferStatus }
  state: { input: undefined; output: AppState }
  networkStatus: { input: undefined; output: NetworkStatus }
  testNetwork: { input: undefined; output: NetworkStatus }
  prepareNetwork: { input: undefined; output: NetworkStatus }
  saveSettings: { input: Partial<Settings>; output: AppState }
  catalog: { input: CatalogRequest; output: CatalogPage }
  providers: { input: { type: MediaType; region: string }; output: Provider[] }
  tvSeasons: { input: { id: string }; output: TVSeason[] }
  tvEpisodes: { input: { id: string; season: number }; output: TVEpisode[] }
  saveTMDB: { input: { token: string }; output: AppState }
  chooseDirectory: { input: undefined; output: string | null }
  torrentFile: { input: undefined; output: string | null }
  searchReleases: { input: Movie; output: { releases: Release[]; errors: string[] } }
  addDownload: { input: { release: Release; movie?: Movie; title?: string }; output: AppState }
  pauseDownload: { input: { id: string }; output: AppState }
  removeDownload: { input: { id: string; deleteFiles?: boolean }; output: AppState }
  reveal: { input: { id: string }; output: void }
  testSource: { input: { source: TorrentSource | SubtitleSource; key?: string }; output: string }
  saveSource: { input: { source: TorrentSource | SubtitleSource; key?: string }; output: AppState }
  deleteSource: { input: { id: string }; output: AppState }
  syncSubtitles: { input: undefined; output: AppState }
  searchSubtitles: { input: { id: string }; output: SubtitleMatch[] }
  useSubtitle: { input: { id: string; matchID: string }; output: AppState }
  importSubtitle: { input: { id: string; language: Language }; output: AppState }
  alignSubtitles: { input: { id: string }; output: AppState }
  restoreTiming: { input: { id: string; language: Language }; output: AppState }
  subtitleCues: { input: { id: string; language: Language }; output: SubtitleCue[] }
  preview: { input: { id: string; start: number; transcode: boolean }; output: Preview }
  thumbnail: { input: { id: string }; output: string | null }
  openLink: { input: { url: string }; output: void }
}
export type Invoke = <K extends keyof CommandMap>(command: K, input: CommandMap[K]['input']) => Promise<CommandMap[K]['output']>
export interface ReelAPI { invoke: Invoke; subscribeUpdates: (callback: (state: UpdateStatus) => void) => () => void; subscribe: (callback: (state: AppState) => void) => () => void }
declare global { interface Window { reel: ReelAPI } }
