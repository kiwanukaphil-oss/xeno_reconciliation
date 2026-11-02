import { UgandaRegion } from '@prisma/client';

/**
 * Reference data for resolving the free-text Ultima "district" field.
 *
 * Districts are grouped by the four statistical regions. Aliases cover common
 * misspellings, alternative spellings, cities/municipalities and Kampala/Wakiso
 * suburbs that clients type instead of a district. Foreign locations map to a
 * country so diaspora clients can be reported separately.
 *
 * Keys are in normalised form: lower case, letters and single spaces only.
 */
export const UGANDA_DISTRICTS_BY_REGION: Record<UgandaRegion, string[]> = {
  CENTRAL: [
    'Buikwe', 'Bukomansimbi', 'Butambala', 'Buvuma', 'Gomba', 'Kalangala', 'Kalungu',
    'Kampala', 'Kasanda', 'Kayunga', 'Kiboga', 'Kyankwanzi', 'Kyotera', 'Luwero',
    'Lwengo', 'Lyantonde', 'Masaka', 'Mityana', 'Mpigi', 'Mubende', 'Mukono',
    'Nakaseke', 'Nakasongola', 'Rakai', 'Sembabule', 'Wakiso',
  ],
  EASTERN: [
    'Amuria', 'Budaka', 'Bududa', 'Bugiri', 'Bugweri', 'Bukedea', 'Bukwo', 'Bulambuli',
    'Busia', 'Butaleja', 'Butebo', 'Buyende', 'Iganga', 'Jinja', 'Kaberamaido', 'Kalaki',
    'Kaliro', 'Kamuli', 'Kapchorwa', 'Kapelebyong', 'Katakwi', 'Kibuku', 'Kumi', 'Kween',
    'Luuka', 'Manafwa', 'Mayuge', 'Mbale', 'Namayingo', 'Namisindwa', 'Namutumba', 'Ngora',
    'Pallisa', 'Serere', 'Sironko', 'Soroti', 'Tororo',
  ],
  NORTHERN: [
    'Abim', 'Adjumani', 'Agago', 'Alebtong', 'Amolatar', 'Amudat', 'Amuru', 'Apac', 'Arua',
    'Dokolo', 'Gulu', 'Kaabong', 'Karenga', 'Kitgum', 'Koboko', 'Kole', 'Kotido', 'Kwania',
    'Lamwo', 'Lira', 'Madi-Okollo', 'Maracha', 'Moroto', 'Moyo', 'Nabilatuk', 'Nakapiripirit',
    'Napak', 'Nebbi', 'Nwoya', 'Obongi', 'Omoro', 'Otuke', 'Oyam', 'Pader', 'Pakwach',
    'Terego', 'Yumbe', 'Zombo',
  ],
  WESTERN: [
    'Buhweju', 'Buliisa', 'Bundibugyo', 'Bunyangabu', 'Bushenyi', 'Hoima', 'Ibanda',
    'Isingiro', 'Kabale', 'Kabarole', 'Kagadi', 'Kakumiro', 'Kamwenge', 'Kanungu', 'Kasese',
    'Kazo', 'Kibaale', 'Kikuube', 'Kiruhura', 'Kiryandongo', 'Kisoro', 'Kitagwenda',
    'Kyegegwa', 'Kyenjojo', 'Masindi', 'Mbarara', 'Mitooma', 'Ntoroko', 'Ntungamo',
    'Rubanda', 'Rubirizi', 'Rukiga', 'Rukungiri', 'Rwampara', 'Sheema',
  ],
};

/** Alternative spellings, towns and suburbs -> canonical district name. */
export const DISTRICT_ALIASES: Record<string, string> = {
  // Kampala misspellings and divisions/suburbs
  kamapala: 'Kampala', kampal: 'Kampala', kampla: 'Kampala', kambala: 'Kampala',
  kamapal: 'Kampala', kamplala: 'Kampala', kampalamakindye: 'Kampala', kamp: 'Kampala',
  kampa: 'Kampala', lungujja: 'Kampala', mpelerwe: 'Kampala',
  nakawa: 'Kampala', makindye: 'Kampala', kawempe: 'Kampala', rubaga: 'Kampala',
  lubaga: 'Kampala', ntinda: 'Kampala', kisaasi: 'Kampala', kisasi: 'Kampala',
  kiwatule: 'Kampala', kulambiro: 'Kampala', nakasero: 'Kampala', kyambogo: 'Kampala',
  busega: 'Kampala', bukasa: 'Kampala', kololo: 'Kampala', muyenga: 'Kampala',
  bugolobi: 'Kampala', naguru: 'Kampala', kansanga: 'Kampala', kabalagala: 'Kampala',
  mengo: 'Kampala', wandegeya: 'Kampala', kamwokya: 'Kampala', bukoto: 'Kampala',
  kyanja: 'Kampala', nsambya: 'Kampala', kibuli: 'Kampala', mutundwe: 'Kampala',
  ndeeba: 'Kampala', kibuye: 'Kampala', ggaba: 'Kampala', munyonyo: 'Kampala',
  kitintale: 'Kampala', luzira: 'Kampala', mbuya: 'Kampala', nateete: 'Kampala',
  // Wakiso towns and suburbs
  entebbe: 'Wakiso', kira: 'Wakiso', kiira: 'Wakiso', nansana: 'Wakiso',
  bweyogerere: 'Wakiso', gayaza: 'Wakiso', kyengera: 'Wakiso', kyegera: 'Wakiso',
  matugga: 'Wakiso', maganjo: 'Wakiso', najjera: 'Wakiso', kasangati: 'Wakiso',
  namugongo: 'Wakiso', kireka: 'Wakiso', nalya: 'Wakiso', kyaliwajjala: 'Wakiso',
  seguku: 'Wakiso', lubowa: 'Wakiso', kajjansi: 'Wakiso', bwebajja: 'Wakiso',
  ssenge: 'Wakiso', namasuba: 'Wakiso', kitende: 'Wakiso', lweza: 'Wakiso',
  buloba: 'Wakiso', kakiri: 'Wakiso', nsangi: 'Wakiso', sonde: 'Wakiso',
  enteebe: 'Wakiso', bulenga: 'Wakiso', nangabo: 'Wakiso',
  // Other towns and alternative spellings
  luweero: 'Luwero', ssembabule: 'Sembabule', seeta: 'Mukono', namanve: 'Mukono',
  lugazi: 'Buikwe', njeru: 'Buikwe', nkokonjeru: 'Buikwe', 'fort portal': 'Kabarole',
  fortportal: 'Kabarole', hima: 'Kasese', bwera: 'Kasese', paidha: 'Zombo',
  malaba: 'Tororo', ishaka: 'Bushenyi', kabwohe: 'Sheema', 'madi okollo': 'Madi-Okollo',
  bukiwe: 'Buikwe', zirobwe: 'Luwero',
};

/** Foreign cities, regions and country names -> country, for diaspora reporting. */
export const FOREIGN_LOCATIONS: Record<string, string> = {
  juba: 'South Sudan', bor: 'South Sudan', wau: 'South Sudan', 'south sudan': 'South Sudan',
  deira: 'United Arab Emirates', sharijah: 'United Arab Emirates',
  'al wakrah': 'Qatar', lusail: 'Qatar', makkah: 'Saudi Arabia', mecca: 'Saudi Arabia',
  bujumbura: 'Burundi', nyarugenge: 'Rwanda', lusaka: 'Zambia', oslo: 'Norway',
  madrid: 'Spain', surrey: 'United Kingdom', ipswich: 'United Kingdom', lancashire: 'United Kingdom',
  houston: 'United States', denver: 'United States', columbus: 'United States',
  spokane: 'United States', wyoming: 'United States',
  dubai: 'United Arab Emirates', 'abu dhabi': 'United Arab Emirates', abudhabi: 'United Arab Emirates',
  sharjah: 'United Arab Emirates', ajman: 'United Arab Emirates', 'umm suqeim': 'United Arab Emirates',
  'jebal ali': 'United Arab Emirates', 'jebel ali': 'United Arab Emirates', 'al qouz': 'United Arab Emirates',
  'al ain': 'United Arab Emirates', uae: 'United Arab Emirates', 'united arab emirates': 'United Arab Emirates',
  doha: 'Qatar', qatar: 'Qatar',
  nairobi: 'Kenya', mombasa: 'Kenya', kisumu: 'Kenya', kenya: 'Kenya',
  london: 'United Kingdom', 'greater london': 'United Kingdom', bristol: 'United Kingdom',
  chelmsford: 'United Kingdom', crawley: 'United Kingdom', bedfordshire: 'United Kingdom',
  'milton keynes': 'United Kingdom', middlesex: 'United Kingdom', manchester: 'United Kingdom',
  birmingham: 'United Kingdom', leeds: 'United Kingdom', luton: 'United Kingdom',
  uk: 'United Kingdom', 'united kingdom': 'United Kingdom', england: 'United Kingdom',
  kuwait: 'Kuwait', 'kuwait city': 'Kuwait',
  kigali: 'Rwanda', gasabo: 'Rwanda', kicukiro: 'Rwanda', rwanda: 'Rwanda',
  jeddah: 'Saudi Arabia', riyadh: 'Saudi Arabia', riyad: 'Saudi Arabia', dammam: 'Saudi Arabia',
  'saudi arabia': 'Saudi Arabia',
  manama: 'Bahrain', bahrain: 'Bahrain', muscat: 'Oman', oman: 'Oman',
  geneva: 'Switzerland', zurich: 'Switzerland', helsinki: 'Finland',
  'dar es salaam': 'Tanzania', ubungo: 'Tanzania', arusha: 'Tanzania', tanzania: 'Tanzania',
  jwaneng: 'Botswana', gaborone: 'Botswana', groningen: 'Netherlands', amsterdam: 'Netherlands',
  wurzburg: 'Germany', berlin: 'Germany', germany: 'Germany', varnamo: 'Sweden',
  stockholm: 'Sweden', sweden: 'Sweden', nancy: 'France', paris: 'France',
  toronto: 'Canada', ottawa: 'Canada', canada: 'Canada',
  johannesburg: 'South Africa', 'cape town': 'South Africa', pretoria: 'South Africa',
  kinshasa: 'DR Congo',
  hoschton: 'United States', dacula: 'United States', buford: 'United States',
  rochester: 'United States', burlington: 'United States', billerica: 'United States',
  'van nuys': 'United States', indiana: 'United States', boston: 'United States',
  atlanta: 'United States', texas: 'United States', 'new york': 'United States',
  california: 'United States', usa: 'United States', 'united states': 'United States',
  'city of campbelltown': 'Australia', campbelltown: 'Australia', sydney: 'Australia',
  melbourne: 'Australia', brisbane: 'Australia', perth: 'Australia',
  'rockhampton regional': 'Australia', australia: 'Australia',
};

/** Values that mean "nothing entered". */
export const BLANK_DISTRICT_VALUES = new Set([
  '', 'n a', 'na', 'none', 'null', 'nil', 'not applicable', 'uganda', 'central', 'x', 'no',
]);
