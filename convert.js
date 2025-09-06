
import { readFile, writeFile } from 'node:fs/promises';
import chalk from 'chalk';
import { Lexicons } from '@atproto/lexicon'

const data = JSON.parse(await readFile(rel('schemaorg-all-https.20250815.json')));
const types = {};
const typeProps = {};
const supportedTypes = {};
const supportedTypeProps = {
  '*': {
    '@id': true,
    '@type': true,
  },
};
const class2props = {};
const properties = {};
// const dataTypes = new Set();
const classes = {}

// These are the only two major things, everything else is specialisation of
// classes
// rdf:Property (1516)
// 	• @id (1516)
// 	• @type (1516)
// 	• rdfs:comment (1516)
// 	• rdfs:label (1516)
// 	• schema:domainIncludes (1515)
// 	• schema:rangeIncludes (1515)
// 	• schema:isPartOf (584)
// 	• schema:source (466)
// 	• schema:contributor (233)
// 	• rdfs:subPropertyOf (156)
// 	• schema:supersededBy (70)
// 	• schema:inverseOf (54)
// 	• owl:equivalentProperty (33)
// 	• skos:exactMatch (19)
// 	• skos:closeMatch (1)
// rdfs:Class (917)
// 	• @id (917)
// 	• @type (917)
// 	• rdfs:comment (917)
// 	• rdfs:label (917)
// 	• rdfs:subClassOf (916)
// 	• schema:isPartOf (287)
// 	• schema:source (200)
// 	• schema:contributor (109)
// 	• owl:equivalentClass (19)
// 	• schema:supersededBy (17)
// 	• skos:closeMatch (4)
// 	• skos:exactMatch (1)

const skip = new Set([
  'schema:CssSelectorType',
  'schema:DataType',
  'schema:Float',
  'schema:Integer',
  'schema:PronounceableText',
  'schema:URL',
  'schema:XPathType',
]);
for (const item of data['@graph']) {
  const id = item['@id'];
  arrayify(item['@type']).forEach(type => {
    if (type === 'rdfs:Class' && arrayify(item['@type']).find(t => t === 'schema:DataType')) return;
    if (skip.has(type)) return;
    // for reporting
    if (!types[type]) types[type] = 0;
    types[type]++;
    if (!typeProps[type]) typeProps[type] = {};
    Object.keys(item).forEach(k => {
      if (!typeProps[type][k]) typeProps[type][k] = 0;
      typeProps[type][k]++;
    });
    if (type === 'rdf:Property') {
      if (item['schema:domainIncludes']) {
        arrayify(item['schema:domainIncludes']).forEach(({ '@id': cl }) => {
          if (!class2props[cl]) class2props[cl] = {};
          class2props[cl][id] = true;
        });
      }
      // properties[lang2string(item['rdfs:label'])] = item;
      properties[id] = item;
    }
    // else if (type === 'schema:DataType') dataTypes.add(id);
    else if (type === 'rdfs:Class') {
      // classes[lang2string(item['rdfs:label'])] = item;
      classes[id] = item;
    }
  });
}

// make a lexicon!
const lexicon = {
  lexicon: 1,
  id: 'org.schema',
  description: 'A lexicon for schema.org',
  defs: {},
};

// data types
// (values are the type of `@value`)
const dataTypes = {
  DateTime: { type: 'string', format: 'datetime' },
  Time: { type: 'string' }, // we can't use datetime
  Number: { type: 'string' }, // this includes floats
  Float: { type: 'string' }, // there are no floats
  Integer: { type: 'integer' },
  Boolean: { type: 'boolean' },
  Text: { type: 'string' },
  CssSelectorType: { type: 'string' },
  PronounceableText: { type: 'string' },
  URL: { type: 'string', format: 'uri' },
  XPathType: { type: 'string' },
  Date: { type: 'string' }, // we can't use datetime
};
Object
  .entries(dataTypes)
  .forEach(([k, v]) => {
    lexicon.defs[k] = {
      type: 'object',
      properties: {
        '@value': v,
      },
    };
  })
;

// classes
Object
  .keys(classes)
  .sort((a, b) => a.localeCompare(b))
  .forEach(id => {
    const cl = classes[id];
    const label = lang2string(cl['rdfs:label'])
    if (skip.has(`schema:${label}`)) return;
    lexicon.defs[label] = {
      type: 'object',
      description: lang2string(cl['rdfs:comment']),
      properties: {},
    };
    // resolve inheritance
    const queue = [id];
    const hierarchy = [];
    while (queue.length) {
      const cur = queue.shift();
      hierarchy.push(cur);
      const def = classes[cur];
      if (skip.has(cur)) continue;
      if (!def) {
        console.warn(chalk.yellow(`No such class: ${cur} in inheritance for ${id}`));
        continue;
      }
      queue.push(...arrayify(def['rdfs:subClassOf']).filter(Boolean).map(cl => cl['@id']));
    }
    const props = {};
    hierarchy.forEach(k => Object.assign(props, class2props[k]));
    Object
      .keys(props)
      .sort((a, b) => a.localeCompare(b))
      .forEach(k => {
        const prop = properties[k];
        const propName = lang2string(prop['rdfs:label'])
        const propDef = {
          description: lang2string(prop['rdfs:comment']),
        };
        // If it's an array, we have a union. But Lexicon unions can only be
        // of objects (I guess for $type disambiguation). Conversely, in
        // schema.org there are often unions of scalars or scalars and classes.
        // Whenever we have a scalar type in a union, we use a class matching
        // the DataType and give it a `@value` property of the right type.
        // That is correct in JSON-LD, even if it's pretty ugly.
        if (prop['schema:rangeIncludes']) {
          if (Array.isArray(prop['schema:rangeIncludes'])) {
            propDef.type = 'union';
            propDef.refs = prop['schema:rangeIncludes'].map(({ '@id': id }) => `#${id.replace(/^\w+:/, '')}`);
          }
          else {
            const label = prop['schema:rangeIncludes']['@id'].replace(/^\w+:/, '');
            if (dataTypes[label]) Object.assign(propDef, dataTypes[label]);
            else {
              propDef.type = 'ref';
              propDef.ref = `#${label}`;
            }
          }
        }
        lexicon.defs[label].properties[propName] = propDef;
      })
    ;
  })
;

await writeFile(rel('schema.lexicon.json'), JSON.stringify(lexicon, null, 2));

// don't do this before saving because it modifies the schema
const lex = new Lexicons();
lex.add(lexicon); // at least it builds

// report();

// report
export function report () {
  sortedEntries(types).forEach(type => {
    console.log(chalk.bold[supportedTypes[type] ? 'green' : 'red'](`${type} (${types[type]})`));
    sortedEntries(typeProps[type]).forEach(prop => {
      const sup = supportedTypeProps?.[type]?.[prop] || supportedTypeProps?.['*']?.[prop];
      console.log(chalk[sup ? 'green' : 'red'](`\t• ${prop} (${typeProps[type][prop]})`));
    });
  });
}

function lang2string (obj) {
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'object' && obj['@language'] === 'en') return obj['@value'];
  console.warn(chalk.yellow(`Unknown string: ${JSON.stringify(obj)}`));
}

function sortedEntries (obj) {
  return Object.entries(obj)
    .sort((a, b) => {
      if (a[1] > b[1]) return -1;
      if (a[1] < b[1]) return 1;
      return 0;
    })
    .map(([k]) => k)
  ;
}

function rel (pth) {
  return new URL(pth, import.meta.url).toString().replace(/^file:\/\//, '');
}

function arrayify (val) {
  return Array.isArray(val) ? val : [val];
}
