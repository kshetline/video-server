// noinspection SpellCheckingInspection
const languageCodes = [
  'Abkhazian', 'ab', 'abk',
  'Afar', 'aa', 'aar',
  'Afrikaans', 'af', 'afr',
  'Akan', 'ak', 'aka',
  'Albanian', 'sq', 'alb',
  'Amharic', 'am', 'amh',
  'Arabic', 'ar', 'ara',
  'Aragonese', 'an', 'arg',
  'Armenian', 'hy', 'arm',
  'Assamese', 'as', 'asm',
  'Avaric', 'av', 'ava',
  'Avestan', 'ae', 'ave',
  'Aymara', 'ay', 'aym',
  'Azerbaijani', 'az', 'aze',
  'Bambara', 'bm', 'bam',
  'Bashkir', 'ba', 'bak',
  'Basque', 'eu', 'baq',
  'Belarusian', 'be', 'bel',
  'Bengali', 'bn', 'ben',
  'Bislama', 'bi', 'bis',
  'Bosnian', 'bs', 'bos',
  'Breton', 'br', 'bre',
  'Bulgarian', 'bg', 'bul',
  'Burmese', 'my', 'bur',
  'Catalan', 'ca', 'cat',
  'Chamorro', 'ch', 'cha',
  'Chechen', 'ce', 'che',
  'Chichewa', 'ny', 'nya',
  'Chinese', 'zh', 'chi',
  'Church Slavonic', 'cu', 'chu',
  'Chuvash', 'cv', 'chv',
  'Cornish', 'kw', 'cor',
  'Corsican', 'co', 'cos',
  'Cree', 'cr', 'cre',
  'Croatian', 'hr', 'hrv',
  'Czech', 'cs', 'cze',
  'Danish', 'da', 'dan',
  'Divehi', 'dv', 'div',
  'Dutch', 'nl', 'dut',
  'Dzongkha', 'dz', 'dzo',
  'English', 'en', 'eng',
  'Esperanto', 'eo', 'epo',
  'Estonian', 'et', 'est',
  'Ewe', 'ee', 'ewe',
  'Faroese', 'fo', 'fao',
  'Fijian', 'fj', 'fij',
  'Finnish', 'fi', 'fin',
  'French', 'fr', 'fre',
  'Western Frisian', 'fy', 'fry',
  'Fulah', 'ff', 'ful',
  'Gaelic', 'gd', 'gla',
  'Galician', 'gl', 'glg',
  'Ganda', 'lg', 'lug',
  'Georgian', 'ka', 'geo',
  'German', 'de', 'ger',
  'Greek', 'el', 'gre',
  'Kalaallisut', 'kl', 'kal',
  'Guarani', 'gn', 'grn',
  'Gujarati', 'gu', 'guj',
  'Haitian', 'ht', 'hat',
  'Hausa', 'ha', 'hau',
  'Hebrew', 'he', 'heb',
  'Herero', 'hz', 'her',
  'Hindi', 'hi', 'hin',
  'Hiri Motu', 'ho', 'hmo',
  'Hungarian', 'hu', 'hun',
  'Icelandic', 'is', 'ice',
  'Ido', 'io', 'ido',
  'Igbo', 'ig', 'ibo',
  'Indonesian', 'id', 'ind',
  'Inuktitut', 'iu', 'iku',
  'Inupiaq', 'ik', 'ipk',
  'Irish', 'ga', 'gle',
  'Italian', 'it', 'ita',
  'Japanese', 'ja', 'jpn',
  'Javanese', 'jv', 'jav',
  'Kannada', 'kn', 'kan',
  'Kanuri', 'kr', 'kau',
  'Kashmiri', 'ks', 'kas',
  'Kazakh', 'kk', 'kaz',
  'Central Khmer', 'km', 'khm',
  'Kikuyu', 'ki', 'kik',
  'Kinyarwanda', 'rw', 'kin',
  'Kirghiz', 'ky', 'kir',
  'Komi', 'kv', 'kom',
  'Kongo', 'kg', 'kon',
  'Korean', 'ko', 'kor',
  'Kuanyama', 'kj', 'kua',
  'Kurdish', 'ku', 'kur',
  'Lao', 'lo', 'lao',
  'Latin', 'la', 'lat',
  'Latvian', 'lv', 'lav',
  'Limburgan', 'li', 'lim',
  'Lingala', 'ln', 'lin',
  'Lithuanian', 'lt', 'lit',
  'Luba-Katanga', 'lu', 'lub',
  'Luxembourgish', 'lb', 'ltz',
  'Macedonian', 'mk', 'mac',
  'Malagasy', 'mg', 'mlg',
  'Malay', 'ms', 'may',
  'Malayalam', 'ml', 'mal',
  'Maltese', 'mt', 'mlt',
  'Manx', 'gv', 'glv',
  'Maori', 'mi', 'mao',
  'Marathi', 'mr', 'mar',
  'Marshallese', 'mh', 'mah',
  'Mongolian', 'mn', 'mon',
  'Nauru', 'na', 'nau',
  'Navajo', 'nv', 'nav',
  'North Ndebele', 'nd', 'nde',
  'South Ndebele', 'nr', 'nbl',
  'Ndonga', 'ng', 'ndo',
  'Nepali', 'ne', 'nep',
  'Norwegian', 'no', 'nor',
  'Norwegian Bokmål', 'nb', 'nob',
  'Norwegian Nynorsk', 'nn', 'nno',
  'Sichuan Yi', 'ii', 'iii',
  'Occitan', 'oc', 'oci',
  'Ojibwa', 'oj', 'oji',
  'Oriya', 'or', 'ori',
  'Oromo', 'om', 'orm',
  'Ossetian', 'os', 'oss',
  'Pali', 'pi', 'pli',
  'Pashto', 'ps', 'pus',
  'Persian', 'fa', 'per',
  'Polish', 'pl', 'pol',
  'Portuguese', 'pt', 'por',
  'Punjabi', 'pa', 'pan',
  'Quechua', 'qu', 'que',
  'Romanian', 'ro', 'rum',
  'Romansh', 'rm', 'roh',
  'Rundi', 'rn', 'run',
  'Russian', 'ru', 'rus',
  'Northern Sami', 'se', 'sme',
  'Samoan', 'sm', 'smo',
  'Sango', 'sg', 'sag',
  'Sanskrit', 'sa', 'san',
  'Sardinian', 'sc', 'srd',
  'Serbian', 'sr', 'srp',
  'Shona', 'sn', 'sna',
  'Sindhi', 'sd', 'snd',
  'Sinhala', 'si', 'sin',
  'Slovak', 'sk', 'slo',
  'Slovenian', 'sl', 'slv',
  'Somali', 'so', 'som',
  'Southern Sotho', 'st', 'sot',
  'Spanish', 'es', 'spa',
  'Sundanese', 'su', 'sun',
  'Swahili', 'sw', 'swa',
  'Swati', 'ss', 'ssw',
  'Swedish', 'sv', 'swe',
  'Tagalog', 'tl', 'tgl',
  'Tahitian', 'ty', 'tah',
  'Tajik', 'tg', 'tgk',
  'Tamil', 'ta', 'tam',
  'Tatar', 'tt', 'tat',
  'Telugu', 'te', 'tel',
  'Thai', 'th', 'tha',
  'Tibetan', 'bo', 'tib',
  'Tigrinya', 'ti', 'tir',
  'Tonga', 'to', 'ton',
  'Tsonga', 'ts', 'tso',
  'Tswana', 'tn', 'tsn',
  'Turkish', 'tr', 'tur',
  'Turkmen', 'tk', 'tuk',
  'Twi', 'tw', 'twi',
  'Uighur', 'ug', 'uig',
  'Ukrainian', 'uk', 'ukr',
  'Urdu', 'ur', 'urd',
  'Uzbek', 'uz', 'uzb',
  'Venda', 've', 'ven',
  'Vietnamese', 'vi', 'vie',
  'Volapük', 'vo', 'vol',
  'Walloon', 'wa', 'wln',
  'Welsh', 'cy', 'wel',
  'Wolof', 'wo', 'wol',
  'Xhosa', 'xh', 'xho',
  'Yiddish', 'yi', 'yid',
  'Yoruba', 'yo', 'yor',
  'Zhuang', 'za', 'zha',
  'Zulu', 'zu', 'zul',

  'Thermian', 'xx', 'mis'
];

export const code2Name = {} as Record<string, string>;
export const lang2to3 = {} as Record<string, string>;
export const lang3to2 = {} as Record<string, string>;
export const name2Code2 = {} as Record<string, string>;

for (let i = 0; i < languageCodes.length - 2; i += 3) {
  const name = languageCodes[i];
  const code2 = languageCodes[i + 1];
  const code3 = languageCodes[i + 2];

  lang2to3[code2] = code3;
  lang3to2[code3] = code2;
  code2Name[code2] = name;
  code2Name[code3] = name;
  name2Code2[name] = code2;
  name2Code2[name.toLowerCase()] = code2;
}

export function getLanguageCode(s: string): string {
  s = s.toLowerCase();

  let code = name2Code2[s.replace(/\s.*$/, '')];

  console.log(s.replace(/(?<=\S+\s+\S+)\s.*$/, ''));

  if (!code && /\s\S+\b/.test(s))
    code = name2Code2[s.replace(/(?<=\S+\s+\S+)\s.*$/, '')];

  return code;
}