import {readCatalog} from '../../../api/server/catalog';
import {locale} from '@mpfrontend/i18n';
export async function GET(request:Request){
  try{return Response.json(await readCatalog(new URL(request.url).searchParams,locale(request.headers.get('Accept-Language'))),{headers:{'Cache-Control':'no-store'}});}
  catch(error){const invalid=error instanceof Error && error.message==='INVALID_QUERY';return Response.json({code:invalid?'INVALID_QUERY':'CATALOG_UNAVAILABLE'},{status:invalid?400:503,headers:{'Cache-Control':'no-store'}});}
}
