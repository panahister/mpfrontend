// Compiled by the typecheck target, never run: each @ts-expect-error must be a real type error.
import {accessReader} from '@mpfrontend/access-core';
import {ResourceForm} from '../src/index.js';

const fields = [{key: 'name', type: 'string', required: true, nullable: false, editable: true}] as const;
const base = {fields, values: {}, onChange: () => {}, onSubmit: () => {}, saveLabel: 'Save'};
const access = accessReader(undefined);

// Without access, `original` is optional.
ResourceForm(base);
ResourceForm({...base, original: {name: 'a'}});
// With access, the form must be told what the person started from, even if that is nothing.
ResourceForm({...base, access, original: {}});
// @ts-expect-error a form with access and without original would send every shown field as changed
ResourceForm({...base, access});
