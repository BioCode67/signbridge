// 재난문자 갈래 코드 → 한국어. **피드에 실제로 나오는 41종을 모두 덮는다.**
// 없으면 `YELLOWDUST` 같은 영문 코드가 화면에 그대로 나간다(실측 사진에서 그랬다).
// 이용자에게는 아무 뜻도 없는 글자다. 이름은 코드를 직역하지 않고 **그 갈래로 온
// 실제 문장을 읽고** 붙였다 — SETUP은 코드만 봐서는 알 수 없지만 문장이 전부
// 대조기·해수면 상승이었다.
// scripts/check_categories.mjs가 피드와 이 표를 대조한다.
const CATEGORY_KO: Record<string, string> = {
  COLDWAVE: '한파', HEAVYSNOW: '대설', HEAVYRAIN: '호우', TYPHOON: '태풍',
  STRONGWIND: '강풍', WINDWAVES: '풍랑', DELUGEFLOOD: '홍수', FLOODING: '침수',
  LANDSLIDE: '산사태', EARTHQUAKE: '지진', FORESTFIRE: '산불', FIRE: '화재',
  EXPLOSION: '폭발', CHEMICALACCIDENT: '화학사고', TRAFFICACCIDENT: '교통사고',
  WEATHER: '기상', FINEDUST: '미세먼지', ANIMALDISEASE: '가축질병',
  PREVENTIONOFINFECTIOUSDISEASES: '감염병', CIVILAIRDEFENSEALERT: '민방위',
  ELECTRICGASACCIDENT: '전기가스', POWEROUTAGESANDPOWERSHORTAGES: '정전',
  RAILWAYSUBWAYTAXIACCIDENT: '교통', BANKINGINFORMATION: '금융',
  YELLOWDUST: '황사', HEATWAVE: '폭염', DROUGHT: '가뭄', THUNDERBOLT: '낙뢰',
  DAMBREAK: '댐 붕괴', VOLCANICERUPTION: '화산 폭발',
  TSUNAMI: '해일', TSUNAMIEARTHQUAKE: '지진해일',
  SETUP: '대조기',              // 문장이 모두 대조기·해수면 상승이었다
  DRINGKINGWATER: '단수·급수',  // 코드 철자가 원본에서 틀려 있다(DRINKING이 아님)
  OILACCIDENT: '유류 사고', ELEVATORSAFETYACCIDENT: '승강기 사고',
  MOUNTAINSAFETYACCIDENT: '산악 사고',
  PREVENTIONOFMISSINGPERSONSKIDNAPPING: '실종·유괴',
  SAFETYACCIDENTATCHILDRENSAMUSEMENTFACILITIES: '어린이 놀이시설',
  SUMMERTIMEWATERGAME: '물놀이', FIRSTAID: '응급처치',
}
export function categoryKo(code: string): string {
  return CATEGORY_KO[code] ?? code.slice(0, 10)
}
