/* The guides in this app (the switcher shows them when there are two or more). Keep this file plain JSON after "SG.GUIDES = ": tools read it.
   Each guide names its data files; only the chosen guide's files are loaded, but every guide is saved for offline use. */
window.SG = window.SG || {};
SG.GUIDES = [
 {"id":"shanghai","title":"上海攻略","subtitle":"Shanghai Guide","place":"Shanghai","china":true,"amapCity":"310000","center":[31.2304,121.4737],"zoom":12,"area":{"latMin":30.4,"latMax":32.0,"lngMin":120.6,"lngMax":122.4},"demo":[31.23293,121.47499,"People's Square"],"places":"data/places.js","added":"data/added.js","files":["data/places.js","data/added.js","data/geo.js","data/labels.js","data/tiles.js"]},
 {"id":"shenzhen","title":"深圳攻略","subtitle":"Shenzhen Guide","place":"Shenzhen","china":true,"amapCity":"440300","center":[22.54228,114.06011],"zoom":13,"area":{"latMin":22.4,"latMax":22.9,"lngMin":113.7,"lngMax":114.7},"demo":[22.54398,114.06301,"Shenzhen Civic Center"],"places":"guides/shenzhen/places.js","added":"guides/shenzhen/added.js","files":["guides/shenzhen/places.js","guides/shenzhen/added.js","guides/shenzhen/geo.js","guides/shenzhen/labels.js","guides/shenzhen/tiles.js"]}
];
