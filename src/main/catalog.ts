import type { CatalogPage, CatalogRequest, Movie, Provider, Language } from '../shared/types'
import { endpoint, json } from './network'
const tmdb = 'https://api.themoviedb.org/3'
export async function providers(token: string, type: string, region: string, language: Language): Promise<Provider[]> {
  if (!token) return []
  const result = await json(endpoint(`${tmdb}/watch/providers/${type}`, { watch_region: region, language: language === 'vi' ? 'vi-VN' : 'en-US' }), { headers: { Authorization: `Bearer ${token}` } })
  if (!Array.isArray(result.results)) throw new Error('Could not read streaming services.')
  return [...new Map<number,Provider>(result.results.map((item: any) => [item.provider_id,{ id: item.provider_id,name:item.provider_name }])).values()].sort((a,b) => a.name.localeCompare(b.name))
}
export async function catalog(input: CatalogRequest, token: string, language: Language): Promise<CatalogPage> {
  if (token) {
    const path = input.query.trim() ? `/search/${input.type}` : `/discover/${input.type}`
    const params: Record<string,string> = { page: String(input.page), language: language === 'vi' ? 'vi-VN' : 'en-US', include_adult: 'false' }
    if (input.query.trim()) params.query = input.query.trim()
    else { params.sort_by = 'popularity.desc'; params.watch_region = input.region; if (input.provider) params.with_watch_providers = String(input.provider) }
    const result = await json(endpoint(tmdb+path,params),{headers:{Authorization:`Bearer ${token}`}})
    if (!Array.isArray(result.results)) throw new Error('Could not read the movie catalog.')
    return { movies: result.results.map((item:any):Movie => ({ id:`tmdb-${input.type}-${item.id}`,title:item.title??item.name,searchTitle:item.original_title??item.original_name??item.title??item.name,year:(item.release_date??item.first_air_date??'').slice(0,4),genre:input.type === 'tv' ? 'TV shows' : 'Movies',overview:item.overview??'',poster:item.poster_path?`https://image.tmdb.org/t/p/w500${item.poster_path}`:undefined,mediaType:input.type })),hasMore:input.page<Math.min(result.total_pages??1,500),attribution:'TMDB catalog · Service availability by JustWatch' }
  }
  if (input.type === 'tv') throw new Error('Add a TMDB token in Settings to browse TV shows.')
  if (!input.query.trim()) {
    const result = await json('https://itunes.apple.com/us/rss/topmovies/limit=50/json')
    if (!Array.isArray(result.feed?.entry)) throw new Error('Could not read the movie catalog.')
    return { movies:result.feed.entry.map((entry:any):Movie => ({id:`apple-${entry.id?.attributes?.['im:id']??entry['im:name'].label}`,title:entry['im:name'].label,searchTitle:entry['im:name'].label,year:entry['im:releaseDate']?.label?.slice(0,4)??'',genre:entry.category?.attributes?.label??'Movies',overview:entry.summary?.label??'',poster:entry['im:image']?.at(-1)?.label?.replace('http://','https://'),mediaType:'movie'})),hasMore:false,attribution:'Apple iTunes catalog · IMDb / Apple title search' }
  }
  const query = input.query.trim().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  try {
    const result = await json(`https://v2.sg.media-imdb.com/suggestion/${encodeURIComponent(query[0])}/${encodeURIComponent(query)}.json`)
    const movies = (result.d??[]).filter((item:any)=>item.qid==='movie'&&/^tt\d+$/.test(item.id)).map((item:any):Movie=>({id:`imdb-${item.id}`,title:item.l,searchTitle:item.l,year:String(item.y??''),genre:'Movies',overview:item.s??'',poster:item.i?.imageUrl,mediaType:'movie'}))
    if (movies.length) return {movies,hasMore:false,attribution:'IMDb title search'}
  } catch {}
  const result = await json(endpoint('https://itunes.apple.com/search',{term:input.query,limit:'100',country:'us',entity:'movie'}))
  return {movies:(result.results??[]).filter((item:any)=>item.kind==='feature-movie').map((item:any):Movie=>({id:`apple-${item.trackId}`,title:item.trackName,searchTitle:item.trackName,year:(item.releaseDate??'').slice(0,4),genre:item.primaryGenreName??'Movies',overview:item.longDescription??'',poster:item.artworkUrl100?.replace('100x100bb','400x600bb'),mediaType:'movie'})),hasMore:false,attribution:'Apple iTunes title search'}
}
