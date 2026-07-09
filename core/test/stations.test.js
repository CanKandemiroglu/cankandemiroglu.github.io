import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sniffDelimiter, parseDelimited, guessColumns, toStations, stationsToGeoJSON,
} from '../src/stations.js';

// ---------------------------------------------------------------- sniffDelimiter

test('sniffDelimiter: plain comma CSV', () => {
  assert.equal(sniffDelimiter('lat,lon,name\n41.0,29.0,K1\n40.9,28.8,K2\n'), ',');
});

test('sniffDelimiter: semicolon file with European decimal commas', () => {
  const text = 'lat;lon;sal\n41,25;29,00;38,5\n42,10;30,20;37,9\n';
  assert.equal(sniffDelimiter(text), ';');
});

test('sniffDelimiter: tab-separated', () => {
  assert.equal(sniffDelimiter('lat\tlon\n41.0\t29.0\n'), '\t');
});

test('sniffDelimiter: delimiters inside quotes are ignored', () => {
  const text = '"a,b",c\n"d,e",f\n';
  assert.equal(sniffDelimiter(text), ',');
  assert.equal(sniffDelimiter('"a;b;c"\tx\n"d;e"\ty\n'), '\t');
});

test('sniffDelimiter: defaults to comma when nothing matches', () => {
  assert.equal(sniffDelimiter('justonecolumn\nvalue\n'), ',');
  assert.equal(sniffDelimiter(''), ',');
});

// ---------------------------------------------------------------- parseDelimited

test('parseDelimited: quoted fields with commas and escaped quotes', () => {
  const text = 'name,notes\n"Kandilli, K1","she said ""hi"""\n';
  const { headers, rows } = parseDelimited(text);
  assert.deepEqual(headers, ['name', 'notes']);
  assert.deepEqual(rows, [['Kandilli, K1', 'she said "hi"']]);
});

test('parseDelimited: quoted field may contain a newline', () => {
  const { rows } = parseDelimited('a,b\n"line1\nline2",x\n');
  assert.deepEqual(rows, [['line1\nline2', 'x']]);
});

test('parseDelimited: CRLF endings and UTF-8 BOM', () => {
  const { headers, rows } = parseDelimited('\uFEFFlat,lon\r\n41.0,29.0\r\n');
  assert.deepEqual(headers, ['lat', 'lon']);
  assert.deepEqual(rows, [['41.0', '29.0']]);
});

test('parseDelimited: blank lines are skipped', () => {
  const { headers, rows } = parseDelimited('\n\na,b\n\n1,2\n   \n3,4\n\n');
  assert.deepEqual(headers, ['a', 'b']);
  assert.deepEqual(rows, [['1', '2'], ['3', '4']]);
});

test('parseDelimited: auto-detects semicolon; explicit delimiter wins', () => {
  const euro = 'lat;lon\n41,25;29,00\n';
  assert.deepEqual(parseDelimited(euro).rows, [['41,25', '29,00']]);
  const { rows } = parseDelimited('a;b\n1;2\n', ';');
  assert.deepEqual(rows, [['1', '2']]);
});

test('parseDelimited: empty input gives empty headers and rows', () => {
  assert.deepEqual(parseDelimited(''), { headers: [], rows: [] });
});

// ------------------------------------------------------------------ guessColumns

test('guessColumns: units in parentheses, case, and underscores are ignored', () => {
  const cols = guessColumns(['Latitude (deg)', 'LON', 'Station ID', 'Depth_m']);
  assert.deepEqual(cols, { lat: 0, lon: 1, name: 2, value: 3 });
});

test('guessColumns: x/y coordinates and value fallback to first spare column', () => {
  const cols = guessColumns(['y', 'x', 'site', 'chlorophyll']);
  assert.deepEqual(cols, { lat: 0, lon: 1, name: 2, value: 3 });
});

test('guessColumns: dec_lat/dec_lon variants; no spare column leaves value -1', () => {
  const cols = guessColumns(['dec_lat', 'dec_lon']);
  assert.deepEqual(cols, { lat: 0, lon: 1, name: -1, value: -1 });
});

test('guessColumns: unrecognisable headers give -1 for lat/lon', () => {
  const cols = guessColumns(['alpha', 'beta']);
  assert.equal(cols.lat, -1);
  assert.equal(cols.lon, -1);
});

// -------------------------------------------------------------------- toStations

test('toStations: happy path with names and values', () => {
  const { stations, errors } = toStations(
    ['lat', 'lon', 'station', 'depth'],
    [['41.08', '29.06', 'K1', '42'], ['40.99', '28.95', 'K2', '55.5']],
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(stations, [
    { lon: 29.06, lat: 41.08, name: 'K1', value: 42 },
    { lon: 28.95, lat: 40.99, name: 'K2', value: 55.5 },
  ]);
});

test('toStations: hemisphere suffixes and degree symbols', () => {
  const { stations, errors } = toStations(
    ['lat', 'lon'],
    [['41.25 S', '70.5 W'], ['41.25°N', '29.06° E']],
  );
  assert.deepEqual(errors, []);
  assert.equal(stations[0].lat, -41.25);
  assert.equal(stations[0].lon, -70.5);
  assert.equal(stations[1].lat, 41.25);
  assert.equal(stations[1].lon, 29.06);
});

test('toStations: wrong-axis hemisphere letter is rejected', () => {
  const { stations, errors } = toStations(['lat', 'lon'], [['41.25 E', '29.0']]);
  assert.equal(stations.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Row 1/);
  assert.match(errors[0], /latitude/);
});

test('toStations: European decimal commas (semicolon file end-to-end)', () => {
  const text = 'Station;Latitude (deg);Longitude (deg);Depth_m\n'
    + 'K1;41,08;29,06;42\n'
    + 'K2;40,99 N;28,95 E;55,5\n';
  const { headers, rows } = parseDelimited(text);
  const { stations, errors } = toStations(headers, rows);
  assert.deepEqual(errors, []);
  assert.deepEqual(stations, [
    { lon: 29.06, lat: 41.08, name: 'K1', value: 42 },
    { lon: 28.95, lat: 40.99, name: 'K2', value: 55.5 },
  ]);
});

test('toStations: TSV parses through the same pipeline', () => {
  const { headers, rows } = parseDelimited('lat\tlon\tname\n41.0\t29.0\tK1\n');
  const { stations, errors } = toStations(headers, rows);
  assert.deepEqual(errors, []);
  assert.deepEqual(stations, [{ lon: 29, lat: 41, name: 'K1', value: null }]);
});

test('toStations: 0-360 longitudes are wrapped into [-180, 180]', () => {
  const { stations, errors } = toStations(
    ['lat', 'lon'],
    [['0', '340'], ['0', '180'], ['0', '360'], ['0', '190.5']],
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(stations.map((s) => s.lon), [-20, 180, 0, -169.5]);
});

test('toStations: bad rows produce errors but good rows survive', () => {
  const { stations, errors } = toStations(
    ['lat', 'lon', 'name'],
    [
      ['41.0', '29.0', 'good1'],
      ['95.0', '29.0', 'lat-out-of-range'],
      ['abc', '29.0', 'garbage-lat'],
      ['40.5', 'xyz', 'garbage-lon'],
      ['40.0', '28.0', 'good2'],
    ],
  );
  assert.deepEqual(stations.map((s) => s.name), ['good1', 'good2']);
  assert.equal(errors.length, 3);
  assert.match(errors[0], /Row 2/);
  assert.match(errors[0], /\[-90, 90\]/);
  assert.match(errors[1], /Row 3.*latitude/);
  assert.match(errors[2], /Row 4.*longitude/);
});

test('toStations: errors are capped at 20 plus a summary line', () => {
  const rows = [];
  for (let i = 0; i < 25; i++) rows.push(['bad', '29.0']);
  rows.push(['41.0', '29.0']);
  const { stations, errors } = toStations(['lat', 'lon'], rows);
  assert.equal(stations.length, 1);
  assert.equal(errors.length, 21);
  assert.equal(errors[20], '…and 5 more');
});

test('toStations: default names are S<row number>; blank rows skipped silently', () => {
  const { stations, errors } = toStations(
    ['lat', 'lon'],
    [['41.0', '29.0'], ['', ''], ['40.0', '28.0']],
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(stations.map((s) => s.name), ['S1', 'S3']);
});

test('toStations: missing lat/lon mapping returns a single explanatory error', () => {
  const { stations, errors } = toStations(['alpha', 'beta'], [['1', '2']]);
  assert.deepEqual(stations, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /No latitude\/longitude columns found/);
});

test('toStations: explicit mapping overrides guessing', () => {
  const { stations, errors } = toStations(
    ['col1', 'col2'],
    [['29.0', '41.0']],
    { lat: 1, lon: 0 },
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(stations, [{ lon: 29, lat: 41, name: 'S1', value: null }]);
});

test('toStations: accepts pre-split rows with numeric cells (spreadsheet path)', () => {
  const { stations, errors } = toStations(
    ['lat', 'lon', 'station', 'depth'],
    [[41.5, 29.2, 7, 100], [40.1, 28.9, 'B', 'n/a']],
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(stations, [
    { lon: 29.2, lat: 41.5, name: '7', value: 100 },
    { lon: 28.9, lat: 40.1, name: 'B', value: null }, // unparseable value -> null
  ]);
});

// -------------------------------------------------------------- stationsToGeoJSON

test('stationsToGeoJSON: Point FeatureCollection with name/value properties', () => {
  const fc = stationsToGeoJSON([
    { lon: 29.06, lat: 41.08, name: 'K1', value: 42 },
    { lon: -70.5, lat: -41.25, name: 'S2', value: null },
  ]);
  assert.equal(fc.type, 'FeatureCollection');
  assert.equal(fc.features.length, 2);
  assert.deepEqual(fc.features[0], {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [29.06, 41.08] },
    properties: { name: 'K1', value: 42 },
  });
  assert.deepEqual(fc.features[1].geometry.coordinates, [-70.5, -41.25]);
  assert.equal(fc.features[1].properties.value, null);
});

test('stationsToGeoJSON: empty and missing input give an empty collection', () => {
  assert.deepEqual(stationsToGeoJSON([]).features, []);
  assert.deepEqual(stationsToGeoJSON().features, []);
});
