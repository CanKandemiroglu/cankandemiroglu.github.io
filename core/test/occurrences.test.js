import test from 'node:test';
import assert from 'node:assert/strict';

import {
  gbifTaxonMatchURL,
  gbifOccurrenceURL,
  obisOccurrenceURL,
  bboxWKT,
  parseGBIF,
  parseOBIS,
  occurrencesToStations,
  dedupeOccurrences,
} from '../src/occurrences.js';

const MED = { west: -6, south: 30, east: 36, north: 46 };

// -------------------------------------------------------------- gbifTaxonMatchURL

test('gbifTaxonMatchURL: hits species/match and percent-encodes the name', () => {
  const url = gbifTaxonMatchURL('Thunnus thynnus');
  assert.equal(url, 'https://api.gbif.org/v1/species/match?name=Thunnus%20thynnus');
});

test('gbifTaxonMatchURL: encodes reserved characters and tolerates blank input', () => {
  assert.ok(gbifTaxonMatchURL('Delphinus delphis & co').includes('name=Delphinus%20delphis%20%26%20co'));
  assert.equal(gbifTaxonMatchURL(), 'https://api.gbif.org/v1/species/match?name=');
});

// ------------------------------------------------------------- gbifOccurrenceURL

test('gbifOccurrenceURL: full canonical query in the documented order', () => {
  const url = gbifOccurrenceURL({ scientificName: 'Thunnus thynnus', bounds: MED });
  assert.equal(
    url,
    'https://api.gbif.org/v1/occurrence/search?'
      + 'scientificName=Thunnus%20thynnus'
      + '&decimalLatitude=30,46'
      + '&decimalLongitude=-6,36'
      + '&hasCoordinate=true'
      + '&limit=200'
      + '&offset=0',
  );
});

test('gbifOccurrenceURL: bbox ranges are south,north and west,east', () => {
  const url = gbifOccurrenceURL({ bounds: MED });
  assert.ok(url.includes('decimalLatitude=30,46'));
  assert.ok(url.includes('decimalLongitude=-6,36'));
  assert.ok(url.includes('hasCoordinate=true'));
});

test('gbifOccurrenceURL: scientificName omitted when blank/whitespace', () => {
  assert.ok(!gbifOccurrenceURL({ bounds: MED }).includes('scientificName='));
  assert.ok(!gbifOccurrenceURL({ scientificName: '   ', bounds: MED }).includes('scientificName='));
  assert.ok(!gbifOccurrenceURL({ scientificName: null, bounds: MED }).includes('scientificName='));
});

test('gbifOccurrenceURL: limit is clamped to [1, 300] and offset carried through', () => {
  assert.ok(gbifOccurrenceURL({ bounds: MED, limit: 999 }).includes('limit=300'));
  assert.ok(gbifOccurrenceURL({ bounds: MED, limit: 0 }).includes('limit=1'));
  assert.ok(gbifOccurrenceURL({ bounds: MED, limit: -50 }).includes('limit=1'));
  assert.ok(gbifOccurrenceURL({ bounds: MED, offset: 600 }).includes('offset=600'));
});

test('gbifOccurrenceURL: invalid bounds throw', () => {
  assert.throws(() => gbifOccurrenceURL({}), TypeError);
  assert.throws(() => gbifOccurrenceURL({ bounds: null }), TypeError);
  assert.throws(() => gbifOccurrenceURL({ bounds: {} }), TypeError);
  assert.throws(() => gbifOccurrenceURL({ bounds: { west: -6, south: 30, east: 36 } }), TypeError);
  assert.throws(
    () => gbifOccurrenceURL({ bounds: { west: -6, south: 30, east: 36, north: 'x' } }),
    TypeError,
  );
  assert.throws(
    () => gbifOccurrenceURL({ bounds: { west: -6, south: 30, east: 36, north: 95 } }),
    TypeError,
  );
});

// --------------------------------------------------------------------- bboxWKT

test('bboxWKT: closes the ring west-south -> east-south -> east-north -> west-north -> west-south', () => {
  assert.equal(bboxWKT(MED), 'POLYGON((-6 30, 36 30, 36 46, -6 46, -6 30))');
});

test('bboxWKT: coordinates are rounded to 5 decimal places', () => {
  const wkt = bboxWKT({ west: -6.1234567, south: 30.0000012, east: 36.1234544, north: 46.5432109 });
  assert.equal(
    wkt,
    'POLYGON((-6.12346 30, 36.12345 30, 36.12345 46.54321, -6.12346 46.54321, -6.12346 30))',
  );
});

test('bboxWKT: throws on invalid bounds', () => {
  assert.throws(() => bboxWKT(undefined), TypeError);
  assert.throws(() => bboxWKT({ west: 0, south: 0, east: 0, north: NaN }), TypeError);
});

// ------------------------------------------------------------- obisOccurrenceURL

test('obisOccurrenceURL: geometry is the URL-encoded closed polygon, plus size', () => {
  const url = obisOccurrenceURL({ scientificName: 'Thunnus thynnus', bounds: MED });
  const wkt = 'POLYGON((-6 30, 36 30, 36 46, -6 46, -6 30))';
  assert.ok(url.startsWith('https://api.obis.org/v3/occurrence?'));
  assert.ok(url.includes('scientificname=Thunnus%20thynnus'));
  assert.ok(url.includes(`geometry=${encodeURIComponent(wkt)}`));
  assert.ok(url.includes('size=1000'));
  // the encoded geometry round-trips back to the WKT ring
  const geom = new URL(url).searchParams.get('geometry');
  assert.equal(geom, wkt);
});

test('obisOccurrenceURL: lowercase scientificname, omitted when blank', () => {
  assert.ok(!obisOccurrenceURL({ bounds: MED }).includes('scientificname='));
  assert.ok(obisOccurrenceURL({ scientificName: 'x', bounds: MED }).includes('scientificname=x'));
});

test('obisOccurrenceURL: size clamped to [1, 10000]', () => {
  assert.ok(obisOccurrenceURL({ bounds: MED, size: 99999 }).includes('size=10000'));
  assert.ok(obisOccurrenceURL({ bounds: MED, size: 0 }).includes('size=1'));
});

test('obisOccurrenceURL: invalid bounds throw', () => {
  assert.throws(() => obisOccurrenceURL({ bounds: {} }), TypeError);
});

// ---------------------------------------------------------------------- parseGBIF

const GBIF_JSON = {
  count: 3,
  endOfRecords: true,
  results: [
    {
      decimalLatitude: 41.2,
      decimalLongitude: 2.18,
      scientificName: 'Thunnus thynnus (Linnaeus, 1758)',
      species: 'Thunnus thynnus',
      eventDate: '2019-06-01',
      depth: 55,
    },
    {
      // missing longitude -> skipped
      decimalLatitude: 40.0,
      scientificName: 'Sardina pilchardus',
      eventDate: '2020-01-01',
    },
    {
      decimalLatitude: 38.5,
      decimalLongitude: 15.1,
      species: 'Xiphias gladius', // no scientificName -> falls back to species
      // no depth -> value null; no eventDate -> date null
    },
  ],
};

test('parseGBIF: maps rows, skips missing coords, reads depth into value', () => {
  const out = parseGBIF(GBIF_JSON);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {
    lon: 2.18,
    lat: 41.2,
    name: 'Thunnus thynnus (Linnaeus, 1758)',
    value: 55,
    date: '2019-06-01',
    source: 'GBIF',
  });
  assert.deepEqual(out[1], {
    lon: 15.1,
    lat: 38.5,
    name: 'Xiphias gladius',
    value: null,
    date: null,
    source: 'GBIF',
  });
});

test('parseGBIF: name falls back to "occurrence"; out-of-range coords clamped', () => {
  const out = parseGBIF({
    results: [{ decimalLatitude: 120, decimalLongitude: -200, depth: 0 }],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'occurrence');
  assert.equal(out[0].lat, 90);
  assert.equal(out[0].lon, -180);
  assert.equal(out[0].value, 0); // depth 0 is a valid finite value
});

test('parseGBIF: tolerates missing/empty results', () => {
  assert.deepEqual(parseGBIF(null), []);
  assert.deepEqual(parseGBIF({}), []);
  assert.deepEqual(parseGBIF({ results: [] }), []);
});

// ---------------------------------------------------------------------- parseOBIS

test('parseOBIS: source is OBIS and depth falls back to minimumDepthInMeters', () => {
  const out = parseOBIS({
    total: 2,
    results: [
      {
        decimalLongitude: 12.5,
        decimalLatitude: 43.1,
        scientificName: 'Caretta caretta',
        eventDate: '2021-08-15',
        minimumDepthInMeters: 12,
      },
      {
        decimalLongitude: 10.0,
        decimalLatitude: 44.0,
        species: 'Mola mola',
        depth: 3,
        minimumDepthInMeters: 99,
      },
    ],
  });
  assert.equal(out.length, 2);
  assert.equal(out[0].source, 'OBIS');
  assert.equal(out[0].value, 12); // depth absent -> minimumDepthInMeters
  assert.equal(out[0].name, 'Caretta caretta');
  assert.equal(out[1].value, 3); // depth present wins over minimumDepthInMeters
});

// ------------------------------------------------------------ occurrencesToStations

test('occurrencesToStations: strips date and source to bare stations', () => {
  const stations = occurrencesToStations(parseGBIF(GBIF_JSON));
  assert.deepEqual(stations, [
    { lon: 2.18, lat: 41.2, name: 'Thunnus thynnus (Linnaeus, 1758)', value: 55 },
    { lon: 15.1, lat: 38.5, name: 'Xiphias gladius', value: null },
  ]);
  for (const s of stations) {
    assert.ok(!('date' in s));
    assert.ok(!('source' in s));
  }
});

test('occurrencesToStations: empty/missing input yields []', () => {
  assert.deepEqual(occurrencesToStations([]), []);
  assert.deepEqual(occurrencesToStations(), []);
});

// ------------------------------------------------------------- dedupeOccurrences

test('dedupeOccurrences: collapses near-duplicates sharing name and rounded coords', () => {
  const list = [
    { lon: 2.180001, lat: 41.200002, name: 'Thunnus thynnus', source: 'GBIF' },
    { lon: 2.180004, lat: 41.199997, name: 'Thunnus thynnus', source: 'OBIS' }, // dup at 4 dp
    { lon: 2.18, lat: 41.2, name: 'Sardina pilchardus' }, // different name -> kept
    { lon: 30.0, lat: 10.0, name: 'Thunnus thynnus' }, // different place -> kept
  ];
  const out = dedupeOccurrences(list);
  assert.equal(out.length, 3);
  assert.equal(out[0].source, 'GBIF'); // first of the duplicate pair is kept
  assert.deepEqual(out.map((o) => o.name), ['Thunnus thynnus', 'Sardina pilchardus', 'Thunnus thynnus']);
});

test('dedupeOccurrences: finer precision keeps points that 4 dp would merge', () => {
  const list = [
    { lon: 2.18001, lat: 41.2, name: 'A' }, // -> 2.1800 at 4 dp, 2.18001 at 5 dp
    { lon: 2.18002, lat: 41.2, name: 'A' }, // -> 2.1800 at 4 dp, 2.18002 at 5 dp
  ];
  assert.equal(dedupeOccurrences(list, 4).length, 1); // merge at 4 dp
  assert.equal(dedupeOccurrences(list, 5).length, 2); // distinct at 5 dp
});

test('dedupeOccurrences: empty/missing input yields []', () => {
  assert.deepEqual(dedupeOccurrences([]), []);
  assert.deepEqual(dedupeOccurrences(), []);
});
