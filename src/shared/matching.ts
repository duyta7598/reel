import type { SubtitleCue, SubtitleMatch } from './types'
export const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
const profile = (value: string) => {
  const clean = value.replace(/\.(mkv|mp4|avi|mov|m4v|srt|webm)$/i, '').toLowerCase()
  const tokens = clean.split(/[^a-z0-9]+/).filter(Boolean)
  const year = tokens.filter(token => /^(19|20)\d{2}$/.test(token)).at(-1)
  const technical = ['480p','720p','1080p','2160p','bluray','brrip','bdrip','web','webrip','webdl','hdtv','dvdrip']
  const boundary = tokens.findIndex(token => token === year || technical.includes(token))
  const normalized = normalize(clean)
  const source = ['bluray','brrip','bdrip'].some(word => normalized.includes(word)) ? 'bluray' : ['webdl','webrip'].some(word => normalized.includes(word)) ? 'web' : normalized.includes('hdtv') ? 'hdtv' : normalized.includes('dvd') ? 'dvd' : undefined
  const resolution = tokens.find(token => /^(480|720|1080|2160)p$/.test(token))
  const codec = ['x265','h265','hevc'].some(word => normalized.includes(word)) ? 'hevc' : ['x264','h264','avc'].some(word => normalized.includes(word)) ? 'avc' : undefined
  const editions = ['extended','unrated','imax','directorscut','theatrical'].filter(word => normalized.includes(word)).join(',')
  const group = clean.includes('-') && clean.split('-').at(-1)!.length < 30 ? normalize(clean.split('-').at(-1)!) : undefined
  return { title: tokens.slice(0, boundary < 0 ? tokens.length : boundary).join(''), year, source, resolution, codec, editions, group }
}
export function confidence(release: string, filename: string): number {
  const stem = filename.replace(/\.(mkv|mp4|avi|mov|m4v|webm)$/i, '')
  if (!release) return 0
  if (normalize(release) === normalize(stem)) return 0.95
  const a = profile(stem), b = profile(release)
  if (!a.title || a.title !== b.title || (a.year && b.year && a.year !== b.year)) return 0
  if (a.editions !== b.editions) return 0.1
  if (a.source && b.source && a.source !== b.source) return 0.2
  let score = 0.55
  if (a.year && a.year === b.year) score += 0.15
  if (a.source && a.source === b.source) score += 0.15
  if (a.resolution && a.resolution === b.resolution) score += 0.02
  if (a.codec && a.codec === b.codec) score += 0.02
  if (a.group && a.group === b.group) score += 0.04
  return Math.min(0.94, Math.round(score * 100) / 100)
}
export function recommended(matches: SubtitleMatch[]): Set<string> {
  const best = new Map<string, SubtitleMatch>()
  for (const match of matches) {
    if (!match.hashMatch && match.confidence < 0.85) continue
    const current = best.get(match.language)
    if (!current || (match.hashMatch && !current.hashMatch) || match.hashMatch === current.hashMatch && match.confidence > current.confidence) best.set(match.language, match)
  }
  return new Set([...best.values()].map(match => match.id))
}
export const quality = (title: string) => title.match(/\b(2160|1080|720|480)p\b/i)?.[0].toLowerCase() ?? 'Unknown'
export function releaseKey(uri: string): string { try { const url = new URL(uri); return url.protocol === 'magnet:' ? url.searchParams.get('xt')?.toLowerCase() ?? uri : uri } catch { return uri } }
export function parseSRT(text: string): SubtitleCue[] {
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split(/\n\s*\n/).flatMap(block => {
    const lines = block.split('\n'), index = lines.findIndex(line => line.includes('-->'))
    if (index < 0) return []
    const times = lines[index].match(/(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})/)
    if (!times) return []
    const values = times.slice(1).map(Number), start = values[0]*3600+values[1]*60+values[2]+values[3]/1000, end = values[4]*3600+values[5]*60+values[6]+values[7]/1000
    return end > start ? [{ start, end, text: lines.slice(index+1).join('\n').replace(/<[^>]*>/g, '') }] : []
  })
}
export function retryDelay(phase: string): number { return phase === 'failed' || phase === 'needsConfiguration' ? 300_000 : phase === 'complete' ? 3_600_000 : 21_600_000 }
export function safeName(title: string): string { return title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '').slice(0,160) || 'Movie' }
