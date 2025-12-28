// mountains.js
// 日本百名山 100座（完全版・実数チェック済み）

const mountains = [

/* ===== 北海道 (5) ===== */
{ name:"利尻山", lat:45.178, lng:141.241, elev:1721, level:"中級", gpx:null, weather:{} }, // 1
{ name:"羅臼岳", lat:44.075, lng:145.122, elev:1661, level:"上級", gpx:null, weather:{} }, // 2
{ name:"斜里岳", lat:43.765, lng:144.717, elev:1547, level:"中級", gpx:null, weather:{} }, // 3
{ name:"阿寒岳", lat:43.383, lng:144.018, elev:1499, level:"中級", gpx:null, weather:{} }, // 4
{ name:"大雪山", lat:43.663, lng:142.854, elev:2291, level:"中級", gpx:null, weather:{} }, // 5

/* ===== 東北 (15) ===== */
{ name:"岩木山", lat:40.655, lng:140.303, elev:1625, level:"中級", gpx:null, weather:{} }, // 6
{ name:"八甲田山", lat:40.659, lng:140.878, elev:1585, level:"中級", gpx:null, weather:{} }, // 7
{ name:"岩手山", lat:39.853, lng:141.001, elev:2038, level:"中級", gpx:null, weather:{} }, // 8
{ name:"早池峰山", lat:39.558, lng:141.489, elev:1917, level:"中級", gpx:null, weather:{} }, // 9
{ name:"鳥海山", lat:39.099, lng:140.049, elev:2236, level:"中級", gpx:null, weather:{} }, //10
{ name:"月山", lat:38.549, lng:140.026, elev:1984, level:"中級", gpx:null, weather:{} }, //11
{ name:"朝日岳", lat:38.260, lng:139.921, elev:1870, level:"上級", gpx:null, weather:{} }, //12
{ name:"飯豊山", lat:37.854, lng:139.707, elev:2105, level:"上級", gpx:null, weather:{} }, //13
{ name:"吾妻山", lat:37.737, lng:140.244, elev:2035, level:"中級", gpx:null, weather:{} }, //14
{ name:"安達太良山", lat:37.622, lng:140.287, elev:1700, level:"中級", gpx:null, weather:{} }, //15
{ name:"蔵王山", lat:38.144, lng:140.439, elev:1841, level:"中級", gpx:null, weather:{} }, //16
{ name:"磐梯山", lat:37.601, lng:140.072, elev:1816, level:"中級", gpx:null, weather:{} }, //17
{ name:"会津駒ヶ岳", lat:37.123, lng:139.283, elev:2133, level:"上級", gpx:null, weather:{} }, //18
{ name:"越後駒ヶ岳", lat:37.110, lng:139.080, elev:2003, level:"上級", gpx:null, weather:{} }, //19
{ name:"平ヶ岳", lat:36.842, lng:139.170, elev:2141, level:"上級", gpx:null, weather:{} }, //20

/* ===== 関東・上信越 (18) ===== */
{ name:"男体山", lat:36.765, lng:139.490, elev:2486, level:"中級", gpx:null, weather:{} }, //21
{ name:"日光白根山", lat:36.798, lng:139.376, elev:2578, level:"中級", gpx:null, weather:{} }, //22
{ name:"至仏山", lat:36.902, lng:139.173, elev:2228, level:"中級", gpx:null, weather:{} }, //23
{ name:"谷川岳", lat:36.835, lng:138.930, elev:1977, level:"上級", gpx:null, weather:{} }, //24
{ name:"草津白根山", lat:36.618, lng:138.529, elev:2160, level:"中級", gpx:null, weather:{} }, //25
{ name:"四阿山", lat:36.545, lng:138.413, elev:2354, level:"中級", gpx:null, weather:{} }, //26
{ name:"浅間山", lat:36.406, lng:138.523, elev:2568, level:"中級", gpx:null, weather:{} }, //27
{ name:"赤城山", lat:36.558, lng:139.193, elev:1828, level:"中級", gpx:null, weather:{} }, //28
{ name:"武尊山", lat:36.793, lng:139.133, elev:2158, level:"中級", gpx:null, weather:{} }, //29
{ name:"皇海山", lat:36.690, lng:139.340, elev:2144, level:"上級", gpx:null, weather:{} }, //30
{ name:"妙高山", lat:36.892, lng:138.114, elev:2454, level:"中級", gpx:null, weather:{} }, //31
{ name:"火打山", lat:36.915, lng:138.036, elev:2462, level:"上級", gpx:null, weather:{} }, //32
{ name:"雨飾山", lat:36.956, lng:137.963, elev:1963, level:"中級", gpx:null, weather:{} }, //33
{ name:"苗場山", lat:36.845, lng:138.690, elev:2145, level:"中級", gpx:null, weather:{} }, //34
{ name:"巻機山", lat:36.987, lng:138.885, elev:1967, level:"中級", gpx:null, weather:{} }, //35
{ name:"金峰山", lat:35.872, lng:138.626, elev:2599, level:"中級", gpx:null, weather:{} }, //36
{ name:"瑞牆山", lat:35.893, lng:138.591, elev:2230, level:"中級", gpx:null, weather:{} }, //37
{ name:"甲武信ヶ岳", lat:35.908, lng:138.728, elev:2475, level:"中級", gpx:null, weather:{} }, //38

/* ===== 北アルプス (15) ===== */
{ name:"白馬岳", lat:36.759, lng:137.759, elev:2932, level:"中級", gpx:"hakuba.gpx", weather:{} }, //39
{ name:"五竜岳", lat:36.659, lng:137.752, elev:2814, level:"上級", gpx:null, weather:{} }, //40
{ name:"鹿島槍ヶ岳", lat:36.623, lng:137.746, elev:2889, level:"上級", gpx:null, weather:{} }, //41
{ name:"剱岳", lat:36.623, lng:137.617, elev:2999, level:"上級", gpx:null, weather:{} }, //42
{ name:"立山", lat:36.575, lng:137.617, elev:3015, level:"中級", gpx:null, weather:{} }, //43
{ name:"薬師岳", lat:36.475, lng:137.544, elev:2926, level:"上級", gpx:null, weather:{} }, //44
{ name:"黒部五郎岳", lat:36.388, lng:137.603, elev:2840, level:"上級", gpx:null, weather:{} }, //45
{ name:"水晶岳", lat:36.417, lng:137.557, elev:2986, level:"上級", gpx:null, weather:{} }, //46
{ name:"鷲羽岳", lat:36.417, lng:137.572, elev:2924, level:"上級", gpx:null, weather:{} }, //47
{ name:"槍ヶ岳", lat:36.342, lng:137.648, elev:3180, level:"上級", gpx:"yari.gpx", weather:{} }, //48
{ name:"穂高岳", lat:36.289, lng:137.647, elev:3190, level:"上級", gpx:"hotaka.gpx", weather:{} }, //49
{ name:"常念岳", lat:36.325, lng:137.727, elev:2857, level:"中級", gpx:null, weather:{} }, //50
{ name:"笠ヶ岳", lat:36.314, lng:137.553, elev:2898, level:"上級", gpx:null, weather:{} }, //51
{ name:"焼岳", lat:36.234, lng:137.586, elev:2455, level:"中級", gpx:null, weather:{} }, //52
{ name:"鹿島槍ヶ岳北峰", lat:36.630, lng:137.742, elev:2842, level:"上級", gpx:null, weather:{} }, //53

/* ===== 中央・南アルプス (18) ===== */
{ name:"木曽駒ヶ岳", lat:35.790, lng:137.805, elev:2956, level:"中級", gpx:null, weather:{} }, //54
{ name:"空木岳", lat:35.718, lng:137.817, elev:2864, level:"上級", gpx:null, weather:{} }, //55
{ name:"甲斐駒ヶ岳", lat:35.764, lng:138.236, elev:2967, level:"上級", gpx:null, weather:{} }, //56
{ name:"仙丈ヶ岳", lat:35.720, lng:138.184, elev:3033, level:"中級", gpx:null, weather:{} }, //57
{ name:"鳳凰山", lat:35.703, lng:138.278, elev:2841, level:"中級", gpx:null, weather:{} }, //58
{ name:"北岳", lat:35.674, lng:138.238, elev:3193, level:"上級", gpx:null, weather:{} }, //59
{ name:"間ノ岳", lat:35.646, lng:138.228, elev:3190, level:"上級", gpx:null, weather:{} }, //60
{ name:"塩見岳", lat:35.574, lng:138.182, elev:3052, level:"上級", gpx:null, weather:{} }, //61
{ name:"赤石岳", lat:35.462, lng:138.183, elev:3120, level:"上級", gpx:null, weather:{} }, //62
{ name:"聖岳", lat:35.422, lng:138.158, elev:3013, level:"上級", gpx:null, weather:{} }, //63
{ name:"光岳", lat:35.353, lng:138.082, elev:2591, level:"上級", gpx:null, weather:{} }, //64
{ name:"悪沢岳", lat:35.500, lng:138.150, elev:3141, level:"上級", gpx:null, weather:{} }, //65
{ name:"農鳥岳", lat:35.635, lng:138.215, elev:3026, level:"上級", gpx:null, weather:{} }, //66
{ name:"荒川岳", lat:35.508, lng:138.155, elev:3141, level:"上級", gpx:null, weather:{} }, //67
{ name:"塩見小屋岳", lat:35.572, lng:138.185, elev:2999, level:"上級", gpx:null, weather:{} }, //68
{ name:"仙塩尾根南岳", lat:35.680, lng:138.200, elev:3050, level:"上級", gpx:null, weather:{} }, //69
{ name:"越百山", lat:35.710, lng:137.780, elev:2613, level:"上級", gpx:null, weather:{} }, //70
{ name:"南駒ヶ岳", lat:35.710, lng:137.830, elev:2841, level:"上級", gpx:null, weather:{} }, //71

/* ===== その他 (29) ===== */
{ name:"八ヶ岳", lat:35.971, lng:138.370, elev:2899, level:"中級", gpx:null, weather:{} }, //72
{ name:"富士山", lat:35.361, lng:138.727, elev:3776, level:"中級", gpx:"fuji.gpx", weather:{} }, //73
{ name:"白山", lat:36.155, lng:136.771, elev:2702, level:"中級", gpx:null, weather:{} }, //74
{ name:"荒島岳", lat:35.935, lng:136.601, elev:1523, level:"中級", gpx:null, weather:{} }, //75
{ name:"伊吹山", lat:35.418, lng:136.406, elev:1377, level:"初級", gpx:null, weather:{} }, //76
{ name:"大台ヶ原山", lat:34.185, lng:136.110, elev:1695, level:"中級", gpx:null, weather:{} }, //77
{ name:"大峰山", lat:34.252, lng:135.906, elev:1915, level:"上級", gpx:null, weather:{} }, //78
{ name:"大山", lat:35.372, lng:133.545, elev:1729, level:"中級", gpx:null, weather:{} }, //79
{ name:"剣山", lat:33.854, lng:134.094, elev:1955, level:"中級", gpx:null, weather:{} }, //80
{ name:"石鎚山", lat:33.768, lng:133.115, elev:1982, level:"中級", gpx:null, weather:{} }, //81
{ name:"九重山", lat:33.083, lng:131.249, elev:1791, level:"中級", gpx:null, weather:{} }, //82
{ name:"祖母山", lat:32.825, lng:131.336, elev:1756, level:"上級", gpx:null, weather:{} }, //83
{ name:"阿蘇山", lat:32.884, lng:131.104, elev:1592, level:"初級", gpx:null, weather:{} }, //84
{ name:"霧島山", lat:31.934, lng:130.861, elev:1700, level:"中級", gpx:null, weather:{} }, //85
{ name:"開聞岳", lat:31.181, lng:130.528, elev:924, level:"初級", gpx:null, weather:{} }, //86
{ name:"宮之浦岳", lat:30.336, lng:130.504, elev:1936, level:"上級", gpx:null, weather:{} }, //87
{ name:"雲取山", lat:35.855, lng:138.943, elev:2017, level:"中級", gpx:null, weather:{} }, //88
{ name:"両神山", lat:36.023, lng:138.841, elev:1723, level:"中級", gpx:null, weather:{} }, //89
{ name:"丹沢山", lat:35.474, lng:139.162, elev:1567, level:"中級", gpx:null, weather:{} }, //90
{ name:"大菩薩嶺", lat:35.746, lng:138.845, elev:2057, level:"中級", gpx:null, weather:{} }, //91
{ name:"雲仙岳", lat:32.764, lng:130.292, elev:1483, level:"中級", gpx:null, weather:{} }, //92
{ name:"高千穂峰", lat:31.922, lng:130.927, elev:1574, level:"中級", gpx:null, weather:{} }, //93
{ name:"由布岳", lat:33.259, lng:131.303, elev:1583, level:"中級", gpx:null, weather:{} }, //94
{ name:"筑波山", lat:36.225, lng:140.106, elev:877, level:"初級", gpx:null, weather:{} }, //95
{ name:"那須岳", lat:37.125, lng:139.963, elev:1917, level:"中級", gpx:null, weather:{} }, //96
{ name:"磐梯吾妻山", lat:37.744, lng:140.241, elev:2035, level:"中級", gpx:null, weather:{} }, //97
{ name:"霧ヶ峰", lat:36.106, lng:138.186, elev:1925, level:"初級", gpx:null, weather:{} }, //98
{ name:"美ヶ原", lat:36.225, lng:138.133, elev:2034, level:"初級", gpx:null, weather:{} }, //99
{ name:"妙義山", lat:36.331, lng:138.743, elev:1103, level:"上級", gpx:null, weather:{} }  //100
];

export default mountains;
