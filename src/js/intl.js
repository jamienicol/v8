// Copyright 2013 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// ECMAScript 402 API implementation.

/**
 * Intl object is a single object that has some named properties,
 * all of which are constructors.
 */
(function(global, utils) {

"use strict";

%CheckIsBootstrapping();

// -------------------------------------------------------------------
// Imports

var ArrayJoin;
var ArrayPush;
var GlobalDate = global.Date;
var GlobalIntl = global.Intl;
var GlobalIntlDateTimeFormat = GlobalIntl.DateTimeFormat;
var GlobalIntlNumberFormat = GlobalIntl.NumberFormat;
var GlobalIntlCollator = GlobalIntl.Collator;
var GlobalIntlPluralRules = GlobalIntl.PluralRules;
var GlobalIntlv8BreakIterator = GlobalIntl.v8BreakIterator;
var GlobalNumber = global.Number;
var GlobalRegExp = global.RegExp;
var GlobalString = global.String;
var GlobalArray = global.Array;
var IntlFallbackSymbol = utils.ImportNow("intl_fallback_symbol");
var InternalArray = utils.InternalArray;
var MathMax = global.Math.max;
var ObjectHasOwnProperty = global.Object.prototype.hasOwnProperty;
var ObjectKeys = global.Object.keys;
var patternSymbol = utils.ImportNow("intl_pattern_symbol");
var resolvedSymbol = utils.ImportNow("intl_resolved_symbol");
var StringSubstr = GlobalString.prototype.substr;
var StringSubstring = GlobalString.prototype.substring;
var ArraySlice = GlobalArray.prototype.slice;

utils.Import(function(from) {
  ArrayJoin = from.ArrayJoin;
  ArrayPush = from.ArrayPush;
});

// Utilities for definitions

macro IS_OBJECT(arg)
(typeof(arg) === 'object')
endmacro

macro NUMBER_IS_NAN(arg)
(%IS_VAR(arg) !== arg)
endmacro

macro NUMBER_IS_FINITE(arg)
(%_IsSmi(%IS_VAR(arg)) || ((arg == arg) && (arg != 1/0) && (arg != -1/0)))
endmacro

// To avoid ES2015 Function name inference.

macro ANONYMOUS_FUNCTION(fn)
(0, (fn))
endmacro

/**
 * Adds bound method to the prototype of the given object.
 */
function AddBoundMethod(obj, methodName, implementation, length, type,
                        compat) {
  %CheckIsBootstrapping();
  var internalName = %CreatePrivateSymbol(methodName);

  DEFINE_METHOD(
    obj.prototype,
    get [methodName]() {
      if(!IS_RECEIVER(this)) {
        throw %make_type_error(kIncompatibleMethodReceiver, methodName, this);
      }
      var receiver = %IntlUnwrapReceiver(this, type, obj, methodName, compat);
      if (IS_UNDEFINED(receiver[internalName])) {
        var boundMethod;
        if (IS_UNDEFINED(length) || length === 2) {
          boundMethod =
            ANONYMOUS_FUNCTION((fst, snd) => implementation(receiver, fst, snd));
        } else if (length === 1) {
          boundMethod = ANONYMOUS_FUNCTION(fst => implementation(receiver, fst));
        } else {
          boundMethod = ANONYMOUS_FUNCTION((...args) => {
            // DateTimeFormat.format needs to be 0 arg method, but can still
            // receive an optional dateValue param. If one was provided, pass it
            // along.
            if (args.length > 0) {
              return implementation(receiver, args[0]);
            } else {
              return implementation(receiver);
            }
          });
        }
        %SetNativeFlag(boundMethod);
        receiver[internalName] = boundMethod;
      }
      return receiver[internalName];
    }
  );
}

function IntlConstruct(receiver, constructor, create, newTarget, args,
                       compat) {
  var locales = args[0];
  var options = args[1];

  var instance = create(locales, options);

  if (compat && IS_UNDEFINED(newTarget) && receiver instanceof constructor) {
    %object_define_property(receiver, IntlFallbackSymbol, { value: instance });
    return receiver;
  }

  return instance;
}



// -------------------------------------------------------------------

/**
 * Caches available locales for each service.
 */
var AVAILABLE_LOCALES = {
   __proto__ : null,
  'collator': UNDEFINED,
  'numberformat': UNDEFINED,
  'dateformat': UNDEFINED,
  'breakiterator': UNDEFINED,
  'pluralrules': UNDEFINED,
  'relativetimeformat': UNDEFINED,
  'listformat': UNDEFINED,
};

/**
 * Caches default ICU locale.
 */
var DEFAULT_ICU_LOCALE = UNDEFINED;

function GetDefaultICULocaleJS() {
  if (IS_UNDEFINED(DEFAULT_ICU_LOCALE)) {
    DEFAULT_ICU_LOCALE = %GetDefaultICULocale();
  }
  return DEFAULT_ICU_LOCALE;
}

/**
 * Unicode extension regular expression.
 */
var UNICODE_EXTENSION_RE = UNDEFINED;

function GetUnicodeExtensionRE() {
  if (IS_UNDEFINED(UNDEFINED)) {
    UNICODE_EXTENSION_RE = new GlobalRegExp('-u(-[a-z0-9]{2,8})+', 'g');
  }
  return UNICODE_EXTENSION_RE;
}

/**
 * Matches any Unicode extension.
 */
var ANY_EXTENSION_RE = UNDEFINED;

function GetAnyExtensionRE() {
  if (IS_UNDEFINED(ANY_EXTENSION_RE)) {
    ANY_EXTENSION_RE = new GlobalRegExp('-[a-z0-9]{1}-.*', 'g');
  }
  return ANY_EXTENSION_RE;
}

/**
 * Replace quoted text (single quote, anything but the quote and quote again).
 */
var QUOTED_STRING_RE = UNDEFINED;

function GetQuotedStringRE() {
  if (IS_UNDEFINED(QUOTED_STRING_RE)) {
    QUOTED_STRING_RE = new GlobalRegExp("'[^']+'", 'g');
  }
  return QUOTED_STRING_RE;
}

/**
 * Matches valid service name.
 */
var SERVICE_RE = UNDEFINED;

function GetServiceRE() {
  if (IS_UNDEFINED(SERVICE_RE)) {
    SERVICE_RE =
        new GlobalRegExp('^(' + %_Call(ArrayJoin, ObjectKeys(AVAILABLE_LOCALES), '|') + ')$');
  }
  return SERVICE_RE;
}

/**
 * Validates a language tag against bcp47 spec.
 * Actual value is assigned on first run.
 */
var LANGUAGE_TAG_RE = UNDEFINED;

function GetLanguageTagRE() {
  if (IS_UNDEFINED(LANGUAGE_TAG_RE)) {
    BuildLanguageTagREs();
  }
  return LANGUAGE_TAG_RE;
}

/**
 * Helps find duplicate variants in the language tag.
 */
var LANGUAGE_VARIANT_RE = UNDEFINED;

function GetLanguageVariantRE() {
  if (IS_UNDEFINED(LANGUAGE_VARIANT_RE)) {
    BuildLanguageTagREs();
  }
  return LANGUAGE_VARIANT_RE;
}

/**
 * Helps find duplicate singletons in the language tag.
 */
var LANGUAGE_SINGLETON_RE = UNDEFINED;

function GetLanguageSingletonRE() {
  if (IS_UNDEFINED(LANGUAGE_SINGLETON_RE)) {
    BuildLanguageTagREs();
  }
  return LANGUAGE_SINGLETON_RE;
}

/**
 * Matches valid IANA time zone names.
 */
var TIMEZONE_NAME_CHECK_RE = UNDEFINED;

function GetTimezoneNameCheckRE() {
  if (IS_UNDEFINED(TIMEZONE_NAME_CHECK_RE)) {
    TIMEZONE_NAME_CHECK_RE = new GlobalRegExp(
        '^([A-Za-z]+)/([A-Za-z_-]+)((?:\/[A-Za-z_-]+)+)*$');
  }
  return TIMEZONE_NAME_CHECK_RE;
}

/**
 * Matches valid location parts of IANA time zone names.
 */
var TIMEZONE_NAME_LOCATION_PART_RE = UNDEFINED;

function GetTimezoneNameLocationPartRE() {
  if (IS_UNDEFINED(TIMEZONE_NAME_LOCATION_PART_RE)) {
    TIMEZONE_NAME_LOCATION_PART_RE =
        new GlobalRegExp('^([A-Za-z]+)((?:[_-][A-Za-z]+)+)*$');
  }
  return TIMEZONE_NAME_LOCATION_PART_RE;
}


/**
 * Returns an intersection of locales and service supported locales.
 * Parameter locales is treated as a priority list.
 */
function supportedLocalesOf(service, locales, options) {
  if (IS_NULL(%regexp_internal_match(GetServiceRE(), service))) {
    throw %make_error(kWrongServiceType, service);
  }

  // Provide defaults if matcher was not specified.
  if (IS_UNDEFINED(options)) {
    options = {__proto__: null};
  } else {
    options = TO_OBJECT(options);
  }

  var matcher = options.localeMatcher;
  if (!IS_UNDEFINED(matcher)) {
    matcher = TO_STRING(matcher);
    if (matcher !== 'lookup' && matcher !== 'best fit') {
      throw %make_range_error(kLocaleMatcher, matcher);
    }
  } else {
    matcher = 'best fit';
  }

  var requestedLocales = initializeLocaleList(locales);

  var availableLocales = getAvailableLocalesOf(service);

  // Use either best fit or lookup algorithm to match locales.
  if (matcher === 'best fit') {
    return initializeLocaleList(bestFitSupportedLocalesOf(
        requestedLocales, availableLocales));
  }

  return initializeLocaleList(lookupSupportedLocalesOf(
      requestedLocales, availableLocales));
}


/**
 * Returns the subset of the provided BCP 47 language priority list for which
 * this service has a matching locale when using the BCP 47 Lookup algorithm.
 * Locales appear in the same order in the returned list as in the input list.
 */
function lookupSupportedLocalesOf(requestedLocales, availableLocales) {
  var matchedLocales = new InternalArray();
  for (var i = 0; i < requestedLocales.length; ++i) {
    // Remove -u- extension.
    var locale = %RegExpInternalReplace(
        GetUnicodeExtensionRE(), requestedLocales[i], '');
    do {
      if (!IS_UNDEFINED(availableLocales[locale])) {
        // Push requested locale not the resolved one.
        %_Call(ArrayPush, matchedLocales, requestedLocales[i]);
        break;
      }
      // Truncate locale if possible, if not break.
      var pos = %StringLastIndexOf(locale, '-');
      if (pos === -1) {
        break;
      }
      locale = %_Call(StringSubstring, locale, 0, pos);
    } while (true);
  }

  return matchedLocales;
}


/**
 * Returns the subset of the provided BCP 47 language priority list for which
 * this service has a matching locale when using the implementation
 * dependent algorithm.
 * Locales appear in the same order in the returned list as in the input list.
 */
function bestFitSupportedLocalesOf(requestedLocales, availableLocales) {
  // TODO(cira): implement better best fit algorithm.
  return lookupSupportedLocalesOf(requestedLocales, availableLocales);
}


/**
 * Returns a getOption function that extracts property value for given
 * options object. If property is missing it returns defaultValue. If value
 * is out of range for that property it throws RangeError.
 */
function getGetOption(options, caller) {
  if (IS_UNDEFINED(options)) throw %make_error(kDefaultOptionsMissing, caller);

  // Ecma 402 #sec-getoption
  var getOption = function (property, type, values, fallback) {
    // 1. Let value be ? Get(options, property).
    var value = options[property];
    // 2. If value is not undefined, then
    if (!IS_UNDEFINED(value)) {
      switch (type) {
        // If type is "boolean", then let value be ToBoolean(value).
        case 'boolean':
          value = TO_BOOLEAN(value);
          break;
        // If type is "string", then let value be ToString(value).
        case 'string':
          value = TO_STRING(value);
          break;
        // Assert: type is "boolean" or "string".
        default:
          throw %make_error(kWrongValueType);
      }

      // d. If values is not undefined, then
      // If values does not contain an element equal to value, throw a
      // RangeError exception.
      if (!IS_UNDEFINED(values) && %ArrayIndexOf(values, value, 0) === -1) {
        throw %make_range_error(kValueOutOfRange, value, caller, property);
      }

      return value;
    }

    return fallback;
  }

  return getOption;
}


/**
 * Ecma 402 9.2.5
 * TODO(jshin): relevantExtensionKeys and localeData need to be taken into
 * account per spec.
 * Compares a BCP 47 language priority list requestedLocales against the locales
 * in availableLocales and determines the best available language to meet the
 * request. Two algorithms are available to match the locales: the Lookup
 * algorithm described in RFC 4647 section 3.4, and an implementation dependent
 * best-fit algorithm. Independent of the locale matching algorithm, options
 * specified through Unicode locale extension sequences are negotiated
 * separately, taking the caller's relevant extension keys and locale data as
 * well as client-provided options into consideration. Returns an object with
 * a locale property whose value is the language tag of the selected locale,
 * and properties for each key in relevantExtensionKeys providing the selected
 * value for that key.
 */
function resolveLocale(service, requestedLocales, options) {
  requestedLocales = initializeLocaleList(requestedLocales);

  var getOption = getGetOption(options, service);
  var matcher = getOption('localeMatcher', 'string',
                          ['lookup', 'best fit'], 'best fit');
  var resolved;
  if (matcher === 'lookup') {
    resolved = lookupMatcher(service, requestedLocales);
  } else {
    resolved = bestFitMatcher(service, requestedLocales);
  }

  return resolved;
}

%InstallToContext([
  "resolve_locale", resolveLocale
]);

/**
 * Look up the longest non-empty prefix of |locale| that is an element of
 * |availableLocales|. Returns undefined when the |locale| is completely
 * unsupported by |availableLocales|.
 */
function bestAvailableLocale(availableLocales, locale) {
  do {
    if (!IS_UNDEFINED(availableLocales[locale])) {
      return locale;
    }
    // Truncate locale if possible.
    var pos = %StringLastIndexOf(locale, '-');
    if (pos === -1) {
      break;
    }
    locale = %_Call(StringSubstring, locale, 0, pos);
  } while (true);

  return UNDEFINED;
}


/**
 * Try to match any mutation of |requestedLocale| against |availableLocales|.
 */
function attemptSingleLookup(availableLocales, requestedLocale) {
  // Remove all extensions.
  var noExtensionsLocale = %RegExpInternalReplace(
      GetAnyExtensionRE(), requestedLocale, '');
  var availableLocale = bestAvailableLocale(
      availableLocales, requestedLocale);
  if (!IS_UNDEFINED(availableLocale)) {
    // Return the resolved locale and extension.
    var extensionMatch = %regexp_internal_match(
        GetUnicodeExtensionRE(), requestedLocale);
    var extension = IS_NULL(extensionMatch) ? '' : extensionMatch[0];
    return {__proto__: null, locale: availableLocale, extension: extension};
  }
  return UNDEFINED;
}


/**
 * Returns best matched supported locale and extension info using basic
 * lookup algorithm.
 */
function lookupMatcher(service, requestedLocales) {
  if (IS_NULL(%regexp_internal_match(GetServiceRE(), service))) {
    throw %make_error(kWrongServiceType, service);
  }

  var availableLocales = getAvailableLocalesOf(service);

  for (var i = 0; i < requestedLocales.length; ++i) {
    var result = attemptSingleLookup(availableLocales, requestedLocales[i]);
    if (!IS_UNDEFINED(result)) {
      return result;
    }
  }

  var defLocale = GetDefaultICULocaleJS();

  // While ECMA-402 returns defLocale directly, we have to check if it is
  // supported, as such support is not guaranteed.
  var result = attemptSingleLookup(availableLocales, defLocale);
  if (!IS_UNDEFINED(result)) {
    return result;
  }

  // Didn't find a match, return default.
  return {
    __proto__: null,
    locale: 'und',
    extension: ''
  };
}


/**
 * Returns best matched supported locale and extension info using
 * implementation dependend algorithm.
 */
function bestFitMatcher(service, requestedLocales) {
  // TODO(cira): implement better best fit algorithm.
  return lookupMatcher(service, requestedLocales);
}


/**
 * Parses Unicode extension into key - value map.
 * Returns empty object if the extension string is invalid.
 * We are not concerned with the validity of the values at this point.
 * 'attribute' in RFC 6047 is not supported. Keys without explicit
 * values are assigned UNDEFINED.
 * TODO(jshin): Fix the handling of 'attribute' (in RFC 6047, but none
 * has been defined so that it's not used) and boolean keys without
 * an explicit value.
 */
function parseExtension(extension) {
  var extensionSplit = %StringSplit(extension, '-', kMaxUint32);

  // Assume ['', 'u', ...] input, but don't throw.
  if (extensionSplit.length <= 2 ||
      (extensionSplit[0] !== '' && extensionSplit[1] !== 'u')) {
    return {__proto__: null};
  }

  // Key is {2}alphanum, value is {3,8}alphanum.
  // Some keys may not have explicit values (booleans).
  var extensionMap = {__proto__: null};
  var key = UNDEFINED;
  var value = UNDEFINED;
  for (var i = 2; i < extensionSplit.length; ++i) {
    var length = extensionSplit[i].length;
    var element = extensionSplit[i];
    if (length === 2) {
      if (!IS_UNDEFINED(key)) {
        if (!(key in extensionMap)) {
          extensionMap[key] = value;
        }
        value = UNDEFINED;
      }
      key = element;
    } else if (length >= 3 && length <= 8 && !IS_UNDEFINED(key)) {
      if (IS_UNDEFINED(value)) {
        value = element;
      } else {
        value = value + "-" + element;
      }
    } else {
      // There is a value that's too long, or that doesn't have a key.
      return {__proto__: null};
    }
  }
  if (!IS_UNDEFINED(key) && !(key in extensionMap)) {
    extensionMap[key] = value;
  }

  return extensionMap;
}


/**
 * Populates internalOptions object with boolean key-value pairs
 * from extensionMap and options.
 * Returns filtered extension (number and date format constructors use
 * Unicode extensions for passing parameters to ICU).
 * It's used for extension-option pairs only, e.g. kn-normalization, but not
 * for 'sensitivity' since it doesn't have extension equivalent.
 * Extensions like nu and ca don't have options equivalent, so we place
 * undefined in the map.property to denote that.
 */
function setOptions(inOptions, extensionMap, keyValues, getOption, outOptions) {
  var extension = '';

  var updateExtension = function updateExtension(key, value) {
    return '-' + key + '-' + TO_STRING(value);
  }

  var updateProperty = function updateProperty(property, type, value) {
    if (type === 'boolean' && (typeof value === 'string')) {
      value = (value === 'true') ? true : false;
    }

    if (!IS_UNDEFINED(property)) {
      defineWEProperty(outOptions, property, value);
    }
  }

  for (var key in keyValues) {
    if (HAS_OWN_PROPERTY(keyValues, key)) {
      var value = UNDEFINED;
      var map = keyValues[key];
      if (!IS_UNDEFINED(map.property)) {
        // This may return true if user specifies numeric: 'false', since
        // Boolean('nonempty') === true.
        value = getOption(map.property, map.type, map.values);
      }
      if (!IS_UNDEFINED(value)) {
        updateProperty(map.property, map.type, value);
        extension += updateExtension(key, value);
        continue;
      }
      // User options didn't have it, check Unicode extension.
      // Here we want to convert strings 'true', 'false' into proper Boolean
      // values (not a user error).
      if (HAS_OWN_PROPERTY(extensionMap, key)) {
        value = extensionMap[key];
        if (!IS_UNDEFINED(value)) {
          updateProperty(map.property, map.type, value);
          extension += updateExtension(key, value);
        } else if (map.type === 'boolean') {
          // Boolean keys are allowed not to have values in Unicode extension.
          // Those default to true.
          updateProperty(map.property, map.type, true);
          extension += updateExtension(key, true);
        }
      }
    }
  }

  return extension === ''? '' : '-u' + extension;
}


/**
 * Given an array-like, outputs an Array with the numbered
 * properties copied over and defined
 * configurable: false, writable: false, enumerable: true.
 * When |expandable| is true, the result array can be expanded.
 */
function freezeArray(input) {
  var array = [];
  var l = input.length;
  for (var i = 0; i < l; i++) {
    if (i in input) {
      %object_define_property(array, i, {value: input[i],
                                         configurable: false,
                                         writable: false,
                                         enumerable: true});
    }
  }

  %object_define_property(array, 'length', {value: l, writable: false});
  return array;
}

/* Make JS array[] out of InternalArray */
function makeArray(input) {
  var array = [];
  %MoveArrayContents(input, array);
  return array;
}

/**
 * Returns an Object that contains all of supported locales for a given
 * service.
 * In addition to the supported locales we add xx-ZZ locale for each xx-Yyyy-ZZ
 * that is supported. This is required by the spec.
 */
function getAvailableLocalesOf(service) {
  // Cache these, they don't ever change per service.
  if (!IS_UNDEFINED(AVAILABLE_LOCALES[service])) {
    return AVAILABLE_LOCALES[service];
  }

  var available = %AvailableLocalesOf(service);

  for (var i in available) {
    if (HAS_OWN_PROPERTY(available, i)) {
      var parts = %regexp_internal_match(
          /^([a-z]{2,3})-([A-Z][a-z]{3})-([A-Z]{2})$/, i);
      if (!IS_NULL(parts)) {
        // Build xx-ZZ. We don't care about the actual value,
        // as long it's not undefined.
        available[parts[1] + '-' + parts[3]] = null;
      }
    }
  }

  AVAILABLE_LOCALES[service] = available;

  return available;
}


/**
 * Defines a property and sets writable and enumerable to true.
 * Configurable is false by default.
 */
function defineWEProperty(object, property, value) {
  %object_define_property(object, property,
                          {value: value, writable: true, enumerable: true});
}


/**
 * Adds property to an object if the value is not undefined.
 * Sets configurable descriptor to false.
 */
function addWEPropertyIfDefined(object, property, value) {
  if (!IS_UNDEFINED(value)) {
    defineWEProperty(object, property, value);
  }
}


/**
 * Defines a property and sets writable, enumerable and configurable to true.
 */
function defineWECProperty(object, property, value) {
  %object_define_property(object, property, {value: value,
                                             writable: true,
                                             enumerable: true,
                                             configurable: true});
}


/**
 * Adds property to an object if the value is not undefined.
 * Sets all descriptors to true.
 */
function addWECPropertyIfDefined(object, property, value) {
  if (!IS_UNDEFINED(value)) {
    defineWECProperty(object, property, value);
  }
}


/**
 * Returns titlecased word, aMeRricA -> America.
 */
function toTitleCaseWord(word) {
  return %StringToUpperCaseIntl(%_Call(StringSubstr, word, 0, 1)) +
         %StringToLowerCaseIntl(%_Call(StringSubstr, word, 1));
}

/**
 * Returns titlecased location, bueNos_airES -> Buenos_Aires
 * or ho_cHi_minH -> Ho_Chi_Minh. It is locale-agnostic and only
 * deals with ASCII only characters.
 * 'of', 'au' and 'es' are special-cased and lowercased.
 */
function toTitleCaseTimezoneLocation(location) {
  var match = %regexp_internal_match(GetTimezoneNameLocationPartRE(), location)
  if (IS_NULL(match)) throw %make_range_error(kExpectedLocation, location);

  var result = toTitleCaseWord(match[1]);
  if (!IS_UNDEFINED(match[2]) && 2 < match.length) {
    // The first character is a separator, '_' or '-'.
    // None of IANA zone names has both '_' and '-'.
    var separator = %_Call(StringSubstring, match[2], 0, 1);
    var parts = %StringSplit(match[2], separator, kMaxUint32);
    for (var i = 1; i < parts.length; i++) {
      var part = parts[i]
      var lowercasedPart = %StringToLowerCaseIntl(part);
      result = result + separator +
          ((lowercasedPart !== 'es' &&
            lowercasedPart !== 'of' && lowercasedPart !== 'au') ?
          toTitleCaseWord(part) : lowercasedPart);
    }
  }
  return result;
}

/**
 * Canonicalizes the language tag, or throws in case the tag is invalid.
 * ECMA 402 9.2.1 steps 7.c ii ~ v.
 */
function canonicalizeLanguageTag(localeID) {
  // null is typeof 'object' so we have to do extra check.
  if ((!IS_STRING(localeID) && !IS_RECEIVER(localeID)) ||
      IS_NULL(localeID)) {
    throw %make_type_error(kLanguageID);
  }

  var localeString = TO_STRING(localeID);

  // Optimize for the most common case; a 2-letter language code in the
  // canonical form/lowercase that is not one of deprecated codes
  // (in, iw, ji, jw). Don't check for ~70 of 3-letter deprecated language
  // codes. Instead, let them be handled by ICU in the slow path. Besides,
  // fast-track 'fil' (3-letter canonical code).
  if ((!IS_NULL(%regexp_internal_match(/^[a-z]{2}$/, localeString)) &&
      IS_NULL(%regexp_internal_match(/^(in|iw|ji|jw)$/, localeString))) ||
      localeString === "fil") {
    return localeString;
  }

  if (isStructuallyValidLanguageTag(localeString) === false) {
    throw %make_range_error(kInvalidLanguageTag, localeString);
  }

  // ECMA 402 6.2.3
  return %CanonicalizeLanguageTag(localeString);
}

/**
 * Returns an InternalArray where all locales are canonicalized and duplicates
 * removed.
 * Throws on locales that are not well formed BCP47 tags.
 * ECMA 402 8.2.1 steps 1 (ECMA 402 9.2.1) and 2.
 */
function canonicalizeLocaleList(locales) {
  var seen = new InternalArray();
  if (!IS_UNDEFINED(locales)) {
    // We allow single string localeID.
    if (typeof locales === 'string') {
      %_Call(ArrayPush, seen, canonicalizeLanguageTag(locales));
      return seen;
    }

    var o = TO_OBJECT(locales);
    var len = TO_LENGTH(o.length);

    for (var k = 0; k < len; k++) {
      if (k in o) {
        var value = o[k];

        var tag = canonicalizeLanguageTag(value);

        if (%ArrayIndexOf(seen, tag, 0) === -1) {
          %_Call(ArrayPush, seen, tag);
        }
      }
    }
  }

  return seen;
}

function initializeLocaleList(locales) {
  return freezeArray(canonicalizeLocaleList(locales));
}

// TODO(ftang): remove the %InstallToContext once
// initializeLocaleList is available in C++
// https://bugs.chromium.org/p/v8/issues/detail?id=7987
%InstallToContext([
  "initialize_locale_list", initializeLocaleList
]);

/**
 * Check the structural Validity of the language tag per ECMA 402 6.2.2:
 *   - Well-formed per RFC 5646 2.1
 *   - There are no duplicate variant subtags
 *   - There are no duplicate singletion (extension) subtags
 *
 * One extra-check is done (from RFC 5646 2.2.9): the tag is compared
 * against the list of grandfathered tags. However, subtags for
 * primary/extended language, script, region, variant are not checked
 * against the IANA language subtag registry.
 *
 * ICU is too permissible and lets invalid tags, like
 * hant-cmn-cn, through.
 *
 * Returns false if the language tag is invalid.
 */
function isStructuallyValidLanguageTag(locale) {
  // Check if it's well-formed, including grandfadered tags.
  if (IS_NULL(%regexp_internal_match(GetLanguageTagRE(), locale))) {
    return false;
  }

  locale = %StringToLowerCaseIntl(locale);

  // Just return if it's a x- form. It's all private.
  if (%StringIndexOf(locale, 'x-', 0) === 0) {
    return true;
  }

  // Check if there are any duplicate variants or singletons (extensions).

  // Remove private use section.
  locale = %StringSplit(locale, '-x-', kMaxUint32)[0];

  // Skip language since it can match variant regex, so we start from 1.
  // We are matching i-klingon here, but that's ok, since i-klingon-klingon
  // is not valid and would fail LANGUAGE_TAG_RE test.
  var variants = new InternalArray();
  var extensions = new InternalArray();
  var parts = %StringSplit(locale, '-', kMaxUint32);
  for (var i = 1; i < parts.length; i++) {
    var value = parts[i];
    if (!IS_NULL(%regexp_internal_match(GetLanguageVariantRE(), value)) &&
        extensions.length === 0) {
      if (%ArrayIndexOf(variants, value, 0) === -1) {
        %_Call(ArrayPush, variants, value);
      } else {
        return false;
      }
    }

    if (!IS_NULL(%regexp_internal_match(GetLanguageSingletonRE(), value))) {
      if (%ArrayIndexOf(extensions, value, 0) === -1) {
        %_Call(ArrayPush, extensions, value);
      } else {
        return false;
      }
    }
  }

  return true;
 }


/**
 * Builds a regular expresion that validates the language tag
 * against bcp47 spec.
 * Uses http://tools.ietf.org/html/bcp47, section 2.1, ABNF.
 * Runs on load and initializes the global REs.
 */
function BuildLanguageTagREs() {
  var alpha = '[a-zA-Z]';
  var digit = '[0-9]';
  var alphanum = '(' + alpha + '|' + digit + ')';
  var regular = '(art-lojban|cel-gaulish|no-bok|no-nyn|zh-guoyu|zh-hakka|' +
                'zh-min|zh-min-nan|zh-xiang)';
  var irregular = '(en-GB-oed|i-ami|i-bnn|i-default|i-enochian|i-hak|' +
                  'i-klingon|i-lux|i-mingo|i-navajo|i-pwn|i-tao|i-tay|' +
                  'i-tsu|sgn-BE-FR|sgn-BE-NL|sgn-CH-DE)';
  var grandfathered = '(' + irregular + '|' + regular + ')';
  var privateUse = '(x(-' + alphanum + '{1,8})+)';

  var singleton = '(' + digit + '|[A-WY-Za-wy-z])';
  LANGUAGE_SINGLETON_RE = new GlobalRegExp('^' + singleton + '$', 'i');

  var extension = '(' + singleton + '(-' + alphanum + '{2,8})+)';

  var variant = '(' + alphanum + '{5,8}|(' + digit + alphanum + '{3}))';
  LANGUAGE_VARIANT_RE = new GlobalRegExp('^' + variant + '$', 'i');

  var region = '(' + alpha + '{2}|' + digit + '{3})';
  var script = '(' + alpha + '{4})';
  var extLang = '(' + alpha + '{3}(-' + alpha + '{3}){0,2})';
  var language = '(' + alpha + '{2,3}(-' + extLang + ')?|' + alpha + '{4}|' +
                 alpha + '{5,8})';
  var langTag = language + '(-' + script + ')?(-' + region + ')?(-' +
                variant + ')*(-' + extension + ')*(-' + privateUse + ')?';

  var languageTag =
      '^(' + langTag + '|' + privateUse + '|' + grandfathered + ')$';
  LANGUAGE_TAG_RE = new GlobalRegExp(languageTag, 'i');
}

// ECMA 402 section 8.2.1
DEFINE_METHOD(
  GlobalIntl,
  getCanonicalLocales(locales) {
    return makeArray(canonicalizeLocaleList(locales));
  }
);

/**
 * Initializes the given object so it's a valid Collator instance.
 * Useful for subclassing.
 */
function CreateCollator(locales, options) {
  if (IS_UNDEFINED(options)) {
    options = {__proto__: null};
  }

  var getOption = getGetOption(options, 'collator');

  var internalOptions = {__proto__: null};

  defineWEProperty(internalOptions, 'usage', getOption(
    'usage', 'string', ['sort', 'search'], 'sort'));

  var sensitivity = getOption('sensitivity', 'string',
                              ['base', 'accent', 'case', 'variant']);
  if (IS_UNDEFINED(sensitivity) && internalOptions.usage === 'sort') {
    sensitivity = 'variant';
  }
  defineWEProperty(internalOptions, 'sensitivity', sensitivity);

  defineWEProperty(internalOptions, 'ignorePunctuation', getOption(
    'ignorePunctuation', 'boolean', UNDEFINED, false));

  var locale = resolveLocale('collator', locales, options);

  // TODO(jshin): ICU now can take kb, kc, etc. Switch over to using ICU
  // directly. See Collator::InitializeCollator and
  // Collator::CreateICUCollator in src/objects/intl-objects.cc
  // ICU can't take kb, kc... parameters through localeID, so we need to pass
  // them as options.
  // One exception is -co- which has to be part of the extension, but only for
  // usage: sort, and its value can't be 'standard' or 'search'.
  var extensionMap = parseExtension(locale.extension);

  /**
   * Map of Unicode extensions to option properties, and their values and types,
   * for a collator.
   */
  var COLLATOR_KEY_MAP = {
    __proto__: null,
    'kn': { __proto__: null, 'property': 'numeric', 'type': 'boolean'},
    'kf': { __proto__: null, 'property': 'caseFirst', 'type': 'string',
           'values': ['false', 'lower', 'upper']}
  };

  setOptions(
      options, extensionMap, COLLATOR_KEY_MAP, getOption, internalOptions);

  var collation = 'default';
  var extension = '';
  if (HAS_OWN_PROPERTY(extensionMap, 'co') && internalOptions.usage === 'sort') {

    /**
     * Allowed -u-co- values. List taken from:
     * http://unicode.org/repos/cldr/trunk/common/bcp47/collation.xml
     */
    var ALLOWED_CO_VALUES = [
      'big5han', 'dict', 'direct', 'ducet', 'gb2312', 'phonebk', 'phonetic',
      'pinyin', 'reformed', 'searchjl', 'stroke', 'trad', 'unihan', 'zhuyin'
    ];

    if (%ArrayIndexOf(ALLOWED_CO_VALUES, extensionMap.co, 0) !== -1) {
      extension = '-u-co-' + extensionMap.co;
      // ICU can't tell us what the collation is, so save user's input.
      collation = extensionMap.co;
    }
  } else if (internalOptions.usage === 'search') {
    extension = '-u-co-search';
  }
  defineWEProperty(internalOptions, 'collation', collation);

  var requestedLocale = locale.locale + extension;

  // We define all properties C++ code may produce, to prevent security
  // problems. If malicious user decides to redefine Object.prototype.locale
  // we can't just use plain x.locale = 'us' or in C++ Set("locale", "us").
  // %object_define_properties will either succeed defining or throw an error.
  var resolved = %object_define_properties({__proto__: null}, {
    caseFirst: {writable: true},
    collation: {value: internalOptions.collation, writable: true},
    ignorePunctuation: {writable: true},
    locale: {writable: true},
    numeric: {writable: true},
    requestedLocale: {value: requestedLocale, writable: true},
    sensitivity: {writable: true},
    strength: {writable: true},
    usage: {value: internalOptions.usage, writable: true}
  });

  var collator = %CreateCollator(requestedLocale, internalOptions, resolved);

  %MarkAsInitializedIntlObjectOfType(collator, COLLATOR_TYPE);
  collator[resolvedSymbol] = resolved;

  return collator;
}


/**
 * Constructs Intl.Collator object given optional locales and options
 * parameters.
 *
 * @constructor
 */
function CollatorConstructor() {
  return IntlConstruct(this, GlobalIntlCollator, CreateCollator, new.target,
                       arguments);
}
%SetCode(GlobalIntlCollator, CollatorConstructor);


/**
 * Collator resolvedOptions method.
 */
DEFINE_METHOD(
  GlobalIntlCollator.prototype,
  resolvedOptions() {
    var methodName = 'resolvedOptions';
    if(!IS_RECEIVER(this)) {
      throw %make_type_error(kIncompatibleMethodReceiver, methodName, this);
    }
    var coll = %IntlUnwrapReceiver(this, COLLATOR_TYPE, GlobalIntlCollator,
                                   methodName, false);
    return {
      locale: coll[resolvedSymbol].locale,
      usage: coll[resolvedSymbol].usage,
      sensitivity: coll[resolvedSymbol].sensitivity,
      ignorePunctuation: coll[resolvedSymbol].ignorePunctuation,
      numeric: coll[resolvedSymbol].numeric,
      caseFirst: coll[resolvedSymbol].caseFirst,
      collation: coll[resolvedSymbol].collation
    };
  }
);


/**
 * Returns the subset of the given locale list for which this locale list
 * has a matching (possibly fallback) locale. Locales appear in the same
 * order in the returned list as in the input list.
 * Options are optional parameter.
 */
DEFINE_METHOD(
  GlobalIntlCollator,
  supportedLocalesOf(locales) {
    return supportedLocalesOf('collator', locales, arguments[1]);
  }
);


/**
 * When the compare method is called with two arguments x and y, it returns a
 * Number other than NaN that represents the result of a locale-sensitive
 * String comparison of x with y.
 * The result is intended to order String values in the sort order specified
 * by the effective locale and collation options computed during construction
 * of this Collator object, and will be negative, zero, or positive, depending
 * on whether x comes before y in the sort order, the Strings are equal under
 * the sort order, or x comes after y in the sort order, respectively.
 */
function compare(collator, x, y) {
  return %InternalCompare(collator, TO_STRING(x), TO_STRING(y));
};


AddBoundMethod(GlobalIntlCollator, 'compare', compare, 2, COLLATOR_TYPE, false);

function PluralRulesConstructor() {
  if (IS_UNDEFINED(new.target)) {
    throw %make_type_error(kConstructorNotFunction, "PluralRules");
  }

  var locales = arguments[0];
  var options = arguments[1];

  if (IS_UNDEFINED(options)) {
    options = {__proto__: null};
  }

  var getOption = getGetOption(options, 'pluralrules');

  var locale = resolveLocale('pluralrules', locales, options);

  var internalOptions = {__proto__: null};
  defineWEProperty(internalOptions, 'type', getOption(
    'type', 'string', ['cardinal', 'ordinal'], 'cardinal'));

  SetNumberFormatDigitOptions(internalOptions, options, 0, 3);

  var requestedLocale = locale.locale;
  var resolved = %object_define_properties({__proto__: null}, {
    type: {value: internalOptions.type, writable: true},
    locale: {writable: true},
    maximumFractionDigits: {writable: true},
    minimumFractionDigits: {writable: true},
    minimumIntegerDigits: {writable: true},
    requestedLocale: {value: requestedLocale, writable: true},
  });
  if (HAS_OWN_PROPERTY(internalOptions, 'minimumSignificantDigits')) {
    defineWEProperty(resolved, 'minimumSignificantDigits', UNDEFINED);
  }
  if (HAS_OWN_PROPERTY(internalOptions, 'maximumSignificantDigits')) {
    defineWEProperty(resolved, 'maximumSignificantDigits', UNDEFINED);
  }
  defineWEProperty(resolved, 'pluralCategories', []);
  var pluralRules = %CreatePluralRules(requestedLocale, internalOptions,
                                       resolved);

  %MarkAsInitializedIntlObjectOfType(pluralRules, PLURAL_RULES_TYPE);
  pluralRules[resolvedSymbol] = resolved;

  return pluralRules;
}
%SetCode(GlobalIntlPluralRules, PluralRulesConstructor);

DEFINE_METHOD(
  GlobalIntlPluralRules.prototype,
  resolvedOptions() {
    if (!%IsInitializedIntlObjectOfType(this, PLURAL_RULES_TYPE)) {
      throw %make_type_error(kIncompatibleMethodReceiver,
                             'Intl.PluralRules.prototype.resolvedOptions',
                             this);
    }

    var result = {
      locale: this[resolvedSymbol].locale,
      type: this[resolvedSymbol].type,
      minimumIntegerDigits: this[resolvedSymbol].minimumIntegerDigits,
      minimumFractionDigits: this[resolvedSymbol].minimumFractionDigits,
      maximumFractionDigits: this[resolvedSymbol].maximumFractionDigits,
    };

    if (HAS_OWN_PROPERTY(this[resolvedSymbol], 'minimumSignificantDigits')) {
      defineWECProperty(result, 'minimumSignificantDigits',
                        this[resolvedSymbol].minimumSignificantDigits);
    }

    if (HAS_OWN_PROPERTY(this[resolvedSymbol], 'maximumSignificantDigits')) {
      defineWECProperty(result, 'maximumSignificantDigits',
                        this[resolvedSymbol].maximumSignificantDigits);
    }

    defineWECProperty(result, 'pluralCategories',
        %_Call(ArraySlice, this[resolvedSymbol].pluralCategories));
    return result;
  }
);

DEFINE_METHOD(
  GlobalIntlPluralRules,
  supportedLocalesOf(locales) {
    return supportedLocalesOf('pluralrules', locales, arguments[1]);
  }
);

DEFINE_METHOD(
  GlobalIntlPluralRules.prototype,
  select(value) {
    if (!%IsInitializedIntlObjectOfType(this, PLURAL_RULES_TYPE)) {
      throw %make_type_error(kIncompatibleMethodReceiver,
                            'Intl.PluralRules.prototype.select',
                            this);
    }

    return %PluralRulesSelect(this, TO_NUMBER(value) + 0);
  }
);

function defaultNumberOption(value, min, max, fallback, property) {
  if (!IS_UNDEFINED(value)) {
    value = TO_NUMBER(value);
    if (NUMBER_IS_NAN(value) || value < min || value > max) {
      throw %make_range_error(kPropertyValueOutOfRange, property);
    }
    return %math_floor(value);
  }

  return fallback;
}

/**
 * Returns the valid digit count for a property, or throws RangeError on
 * a value out of the range.
 */
function getNumberOption(options, property, min, max, fallback) {
  var value = options[property];
  return defaultNumberOption(value, min, max, fallback, property);
}

// ECMA 402 #sec-setnfdigitoptions
// SetNumberFormatDigitOptions ( intlObj, options, mnfdDefault, mxfdDefault )
function SetNumberFormatDigitOptions(internalOptions, options,
                                     mnfdDefault, mxfdDefault) {
  // Digit ranges.
  var mnid = getNumberOption(options, 'minimumIntegerDigits', 1, 21, 1);
  defineWEProperty(internalOptions, 'minimumIntegerDigits', mnid);

  var mnfd = getNumberOption(options, 'minimumFractionDigits', 0, 20,
                             mnfdDefault);
  defineWEProperty(internalOptions, 'minimumFractionDigits', mnfd);

  var mxfdActualDefault = MathMax(mnfd, mxfdDefault);

  var mxfd = getNumberOption(options, 'maximumFractionDigits', mnfd, 20,
                             mxfdActualDefault);

  defineWEProperty(internalOptions, 'maximumFractionDigits', mxfd);

  var mnsd = options['minimumSignificantDigits'];
  var mxsd = options['maximumSignificantDigits'];
  if (!IS_UNDEFINED(mnsd) || !IS_UNDEFINED(mxsd)) {
    mnsd = defaultNumberOption(mnsd, 1, 21, 1, 'minimumSignificantDigits');
    defineWEProperty(internalOptions, 'minimumSignificantDigits', mnsd);

    mxsd = defaultNumberOption(mxsd, mnsd, 21, 21, 'maximumSignificantDigits');
    defineWEProperty(internalOptions, 'maximumSignificantDigits', mxsd);
  }
}

/**
 * Initializes the given object so it's a valid NumberFormat instance.
 * Useful for subclassing.
 */
function CreateNumberFormat(locales, options) {
  if (IS_UNDEFINED(options)) {
    options = {__proto__: null};
  }

  var getOption = getGetOption(options, 'numberformat');

  var locale = resolveLocale('numberformat', locales, options);

  var internalOptions = {__proto__: null};
  defineWEProperty(internalOptions, 'style', getOption(
    'style', 'string', ['decimal', 'percent', 'currency'], 'decimal'));

  var currency = getOption('currency', 'string');
  if (!IS_UNDEFINED(currency) && !%IsWellFormedCurrencyCode(currency)) {
    throw %make_range_error(kInvalidCurrencyCode, currency);
  }

  if (internalOptions.style === 'currency' && IS_UNDEFINED(currency)) {
    throw %make_type_error(kCurrencyCode);
  }

  var mnfdDefault, mxfdDefault;

  var currencyDisplay = getOption(
      'currencyDisplay', 'string', ['code', 'symbol', 'name'], 'symbol');
  if (internalOptions.style === 'currency') {
    defineWEProperty(internalOptions, 'currency', %StringToUpperCaseIntl(currency));
    defineWEProperty(internalOptions, 'currencyDisplay', currencyDisplay);

    mnfdDefault = mxfdDefault = %CurrencyDigits(internalOptions.currency);
  } else {
    mnfdDefault = 0;
    mxfdDefault = internalOptions.style === 'percent' ? 0 : 3;
  }

  SetNumberFormatDigitOptions(internalOptions, options, mnfdDefault,
                              mxfdDefault);

  // Grouping.
  defineWEProperty(internalOptions, 'useGrouping', getOption(
    'useGrouping', 'boolean', UNDEFINED, true));

  // ICU prefers options to be passed using -u- extension key/values for
  // number format, so we need to build that.
  var extensionMap = parseExtension(locale.extension);

  /**
   * Map of Unicode extensions to option properties, and their values and types,
   * for a number format.
   */
  var NUMBER_FORMAT_KEY_MAP = {
    __proto__: null,
    'nu': {__proto__: null, 'property': UNDEFINED, 'type': 'string'}
  };

  var extension = setOptions(options, extensionMap, NUMBER_FORMAT_KEY_MAP,
                             getOption, internalOptions);

  var requestedLocale = locale.locale + extension;
  var resolved = %object_define_properties({__proto__: null}, {
    currency: {writable: true},
    currencyDisplay: {writable: true},
    locale: {writable: true},
    maximumFractionDigits: {writable: true},
    minimumFractionDigits: {writable: true},
    minimumIntegerDigits: {writable: true},
    numberingSystem: {writable: true},
    requestedLocale: {value: requestedLocale, writable: true},
    style: {value: internalOptions.style, writable: true},
    useGrouping: {writable: true}
  });
  if (HAS_OWN_PROPERTY(internalOptions, 'minimumSignificantDigits')) {
    defineWEProperty(resolved, 'minimumSignificantDigits', UNDEFINED);
  }
  if (HAS_OWN_PROPERTY(internalOptions, 'maximumSignificantDigits')) {
    defineWEProperty(resolved, 'maximumSignificantDigits', UNDEFINED);
  }
  var numberFormat = %CreateNumberFormat(requestedLocale, internalOptions,
                                         resolved);

  if (internalOptions.style === 'currency') {
    %object_define_property(resolved, 'currencyDisplay',
        {value: currencyDisplay, writable: true});
  }

  %MarkAsInitializedIntlObjectOfType(numberFormat, NUMBER_FORMAT_TYPE);
  numberFormat[resolvedSymbol] = resolved;

  return numberFormat;
}


/**
 * Constructs Intl.NumberFormat object given optional locales and options
 * parameters.
 *
 * @constructor
 */
function NumberFormatConstructor() {
  return IntlConstruct(this, GlobalIntlNumberFormat, CreateNumberFormat,
                       new.target, arguments, true);
}
%SetCode(GlobalIntlNumberFormat, NumberFormatConstructor);


/**
 * NumberFormat resolvedOptions method.
 */
DEFINE_METHOD(
  GlobalIntlNumberFormat.prototype,
  resolvedOptions() {
    var methodName = 'resolvedOptions';
    if(!IS_RECEIVER(this)) {
      throw %make_type_error(kIncompatibleMethodReceiver, methodName, this);
    }
    var format = %IntlUnwrapReceiver(this, NUMBER_FORMAT_TYPE,
                                     GlobalIntlNumberFormat,
                                     methodName, true);
    var result = {
      locale: format[resolvedSymbol].locale,
      numberingSystem: format[resolvedSymbol].numberingSystem,
      style: format[resolvedSymbol].style,
      useGrouping: format[resolvedSymbol].useGrouping,
      minimumIntegerDigits: format[resolvedSymbol].minimumIntegerDigits,
      minimumFractionDigits: format[resolvedSymbol].minimumFractionDigits,
      maximumFractionDigits: format[resolvedSymbol].maximumFractionDigits,
    };

    if (result.style === 'currency') {
      defineWECProperty(result, 'currency', format[resolvedSymbol].currency);
      defineWECProperty(result, 'currencyDisplay',
                        format[resolvedSymbol].currencyDisplay);
    }

    if (HAS_OWN_PROPERTY(format[resolvedSymbol], 'minimumSignificantDigits')) {
      defineWECProperty(result, 'minimumSignificantDigits',
                        format[resolvedSymbol].minimumSignificantDigits);
    }

    if (HAS_OWN_PROPERTY(format[resolvedSymbol], 'maximumSignificantDigits')) {
      defineWECProperty(result, 'maximumSignificantDigits',
                        format[resolvedSymbol].maximumSignificantDigits);
    }

    return result;
  }
);


/**
 * Returns the subset of the given locale list for which this locale list
 * has a matching (possibly fallback) locale. Locales appear in the same
 * order in the returned list as in the input list.
 * Options are optional parameter.
 */
DEFINE_METHOD(
  GlobalIntlNumberFormat,
  supportedLocalesOf(locales) {
    return supportedLocalesOf('numberformat', locales, arguments[1]);
  }
);

/**
 * Returns a string that matches LDML representation of the options object.
 */
function toLDMLString(options) {
  var getOption = getGetOption(options, 'dateformat');

  var ldmlString = '';

  var option = getOption('weekday', 'string', ['narrow', 'short', 'long']);
  ldmlString += appendToLDMLString(
      option, {narrow: 'EEEEE', short: 'EEE', long: 'EEEE'});

  option = getOption('era', 'string', ['narrow', 'short', 'long']);
  ldmlString += appendToLDMLString(
      option, {narrow: 'GGGGG', short: 'GGG', long: 'GGGG'});

  option = getOption('year', 'string', ['2-digit', 'numeric']);
  ldmlString += appendToLDMLString(option, {'2-digit': 'yy', 'numeric': 'y'});

  option = getOption('month', 'string',
                     ['2-digit', 'numeric', 'narrow', 'short', 'long']);
  ldmlString += appendToLDMLString(option, {'2-digit': 'MM', 'numeric': 'M',
          'narrow': 'MMMMM', 'short': 'MMM', 'long': 'MMMM'});

  option = getOption('day', 'string', ['2-digit', 'numeric']);
  ldmlString += appendToLDMLString(
      option, {'2-digit': 'dd', 'numeric': 'd'});

  var hr12 = getOption('hour12', 'boolean');
  option = getOption('hour', 'string', ['2-digit', 'numeric']);
  if (IS_UNDEFINED(hr12)) {
    ldmlString += appendToLDMLString(option, {'2-digit': 'jj', 'numeric': 'j'});
  } else if (hr12 === true) {
    ldmlString += appendToLDMLString(option, {'2-digit': 'hh', 'numeric': 'h'});
  } else {
    ldmlString += appendToLDMLString(option, {'2-digit': 'HH', 'numeric': 'H'});
  }

  option = getOption('minute', 'string', ['2-digit', 'numeric']);
  ldmlString += appendToLDMLString(option, {'2-digit': 'mm', 'numeric': 'm'});

  option = getOption('second', 'string', ['2-digit', 'numeric']);
  ldmlString += appendToLDMLString(option, {'2-digit': 'ss', 'numeric': 's'});

  option = getOption('timeZoneName', 'string', ['short', 'long']);
  ldmlString += appendToLDMLString(option, {short: 'z', long: 'zzzz'});

  return ldmlString;
}


/**
 * Returns either LDML equivalent of the current option or empty string.
 */
function appendToLDMLString(option, pairs) {
  if (!IS_UNDEFINED(option)) {
    return pairs[option];
  } else {
    return '';
  }
}


/**
 * Returns object that matches LDML representation of the date.
 */
function fromLDMLString(ldmlString) {
  // First remove '' quoted text, so we lose 'Uhr' strings.
  ldmlString = %RegExpInternalReplace(GetQuotedStringRE(), ldmlString, '');

  var options = {__proto__: null};
  var match = %regexp_internal_match(/E{3,5}/, ldmlString);
  options = appendToDateTimeObject(
      options, 'weekday', match, {EEEEE: 'narrow', EEE: 'short', EEEE: 'long'});

  match = %regexp_internal_match(/G{3,5}/, ldmlString);
  options = appendToDateTimeObject(
      options, 'era', match, {GGGGG: 'narrow', GGG: 'short', GGGG: 'long'});

  match = %regexp_internal_match(/y{1,2}/, ldmlString);
  options = appendToDateTimeObject(
      options, 'year', match, {y: 'numeric', yy: '2-digit'});

  match = %regexp_internal_match(/M{1,5}/, ldmlString);
  options = appendToDateTimeObject(options, 'month', match, {MM: '2-digit',
      M: 'numeric', MMMMM: 'narrow', MMM: 'short', MMMM: 'long'});

  // Sometimes we get L instead of M for month - standalone name.
  match = %regexp_internal_match(/L{1,5}/, ldmlString);
  options = appendToDateTimeObject(options, 'month', match, {LL: '2-digit',
      L: 'numeric', LLLLL: 'narrow', LLL: 'short', LLLL: 'long'});

  match = %regexp_internal_match(/d{1,2}/, ldmlString);
  options = appendToDateTimeObject(
      options, 'day', match, {d: 'numeric', dd: '2-digit'});

  match = %regexp_internal_match(/h{1,2}/, ldmlString);
  if (match !== null) {
    options['hour12'] = true;
  }
  options = appendToDateTimeObject(
      options, 'hour', match, {h: 'numeric', hh: '2-digit'});

  match = %regexp_internal_match(/H{1,2}/, ldmlString);
  if (match !== null) {
    options['hour12'] = false;
  }
  options = appendToDateTimeObject(
      options, 'hour', match, {H: 'numeric', HH: '2-digit'});

  match = %regexp_internal_match(/m{1,2}/, ldmlString);
  options = appendToDateTimeObject(
      options, 'minute', match, {m: 'numeric', mm: '2-digit'});

  match = %regexp_internal_match(/s{1,2}/, ldmlString);
  options = appendToDateTimeObject(
      options, 'second', match, {s: 'numeric', ss: '2-digit'});

  match = %regexp_internal_match(/z|zzzz/, ldmlString);
  options = appendToDateTimeObject(
      options, 'timeZoneName', match, {z: 'short', zzzz: 'long'});

  return options;
}


function appendToDateTimeObject(options, option, match, pairs) {
  if (IS_NULL(match)) {
    if (!HAS_OWN_PROPERTY(options, option)) {
      defineWEProperty(options, option, UNDEFINED);
    }
    return options;
  }

  var property = match[0];
  defineWEProperty(options, option, pairs[property]);

  return options;
}


/**
 * Returns options with at least default values in it.
 */
function toDateTimeOptions(options, required, defaults) {
  if (IS_UNDEFINED(options)) {
    options = {__proto__: null};
  } else {
    options = TO_OBJECT(options);
  }

  options = %object_create(options);

  var needsDefault = true;
  if ((required === 'date' || required === 'any') &&
      (!IS_UNDEFINED(options.weekday) || !IS_UNDEFINED(options.year) ||
       !IS_UNDEFINED(options.month) || !IS_UNDEFINED(options.day))) {
    needsDefault = false;
  }

  if ((required === 'time' || required === 'any') &&
      (!IS_UNDEFINED(options.hour) || !IS_UNDEFINED(options.minute) ||
       !IS_UNDEFINED(options.second))) {
    needsDefault = false;
  }

  if (needsDefault && (defaults === 'date' || defaults === 'all')) {
    %object_define_property(options, 'year', {value: 'numeric',
                                              writable: true,
                                              enumerable: true,
                                              configurable: true});
    %object_define_property(options, 'month', {value: 'numeric',
                                               writable: true,
                                               enumerable: true,
                                               configurable: true});
    %object_define_property(options, 'day', {value: 'numeric',
                                             writable: true,
                                             enumerable: true,
                                             configurable: true});
  }

  if (needsDefault && (defaults === 'time' || defaults === 'all')) {
    %object_define_property(options, 'hour', {value: 'numeric',
                                              writable: true,
                                              enumerable: true,
                                              configurable: true});
    %object_define_property(options, 'minute', {value: 'numeric',
                                                writable: true,
                                                enumerable: true,
                                                configurable: true});
    %object_define_property(options, 'second', {value: 'numeric',
                                                writable: true,
                                                enumerable: true,
                                                configurable: true});
  }

  return options;
}


/**
 * Initializes the given object so it's a valid DateTimeFormat instance.
 * Useful for subclassing.
 */
function CreateDateTimeFormat(locales, options) {
  if (IS_UNDEFINED(options)) {
    options = {__proto__: null};
  }

  var locale = resolveLocale('dateformat', locales, options);

  options = toDateTimeOptions(options, 'any', 'date');

  var getOption = getGetOption(options, 'dateformat');

  // We implement only best fit algorithm, but still need to check
  // if the formatMatcher values are in range.
  var matcher = getOption('formatMatcher', 'string',
                          ['basic', 'best fit'], 'best fit');

  // Build LDML string for the skeleton that we pass to the formatter.
  var ldmlString = toLDMLString(options);

  // Filter out supported extension keys so we know what to put in resolved
  // section later on.
  // We need to pass calendar and number system to the method.
  var tz = canonicalizeTimeZoneID(options.timeZone);

  // ICU prefers options to be passed using -u- extension key/values, so
  // we need to build that.
  var internalOptions = {__proto__: null};
  var extensionMap = parseExtension(locale.extension);

  /**
   * Map of Unicode extensions to option properties, and their values and types,
   * for a date/time format.
   */
  var DATETIME_FORMAT_KEY_MAP = {
    __proto__: null,
    'ca': {__proto__: null, 'property': UNDEFINED, 'type': 'string'},
    'nu': {__proto__: null, 'property': UNDEFINED, 'type': 'string'}
  };

  var extension = setOptions(options, extensionMap, DATETIME_FORMAT_KEY_MAP,
                             getOption, internalOptions);

  var requestedLocale = locale.locale + extension;
  var resolved = %object_define_properties({__proto__: null}, {
    calendar: {writable: true},
    day: {writable: true},
    era: {writable: true},
    hour12: {writable: true},
    hour: {writable: true},
    locale: {writable: true},
    minute: {writable: true},
    month: {writable: true},
    numberingSystem: {writable: true},
    [patternSymbol]: {writable: true},
    requestedLocale: {value: requestedLocale, writable: true},
    second: {writable: true},
    timeZone: {writable: true},
    timeZoneName: {writable: true},
    tz: {value: tz, writable: true},
    weekday: {writable: true},
    year: {writable: true}
  });

  var dateFormat = %CreateDateTimeFormat(
    requestedLocale,
    {__proto__: null, skeleton: ldmlString, timeZone: tz}, resolved);

  if (resolved.timeZone === "Etc/Unknown") {
    throw %make_range_error(kUnsupportedTimeZone, tz);
  }

  %MarkAsInitializedIntlObjectOfType(dateFormat, DATE_TIME_FORMAT_TYPE);
  dateFormat[resolvedSymbol] = resolved;

  return dateFormat;
}


/**
 * Constructs Intl.DateTimeFormat object given optional locales and options
 * parameters.
 *
 * @constructor
 */
function DateTimeFormatConstructor() {
  return IntlConstruct(this, GlobalIntlDateTimeFormat, CreateDateTimeFormat,
                       new.target, arguments, true);
}
%SetCode(GlobalIntlDateTimeFormat, DateTimeFormatConstructor);


/**
 * DateTimeFormat resolvedOptions method.
 */
DEFINE_METHOD(
  GlobalIntlDateTimeFormat.prototype,
  resolvedOptions() {
    var methodName = 'resolvedOptions';
    if(!IS_RECEIVER(this)) {
      throw %make_type_error(kIncompatibleMethodReceiver, methodName, this);
    }
    var format = %IntlUnwrapReceiver(this, DATE_TIME_FORMAT_TYPE,
                                     GlobalIntlDateTimeFormat,
                                     methodName, true);

    /**
     * Maps ICU calendar names to LDML/BCP47 types for key 'ca'.
     * See typeMap section in third_party/icu/source/data/misc/keyTypeData.txt
     * and
     * http://www.unicode.org/repos/cldr/tags/latest/common/bcp47/calendar.xml
     */
    var ICU_CALENDAR_MAP = {
      __proto__: null,
      'gregorian': 'gregory',
      'ethiopic-amete-alem': 'ethioaa'
    };

    var fromPattern = fromLDMLString(format[resolvedSymbol][patternSymbol]);
    var userCalendar = ICU_CALENDAR_MAP[format[resolvedSymbol].calendar];
    if (IS_UNDEFINED(userCalendar)) {
      // No match means that ICU's legacy name is identical to LDML/BCP type.
      userCalendar = format[resolvedSymbol].calendar;
    }

    var result = {
      locale: format[resolvedSymbol].locale,
      numberingSystem: format[resolvedSymbol].numberingSystem,
      calendar: userCalendar,
      timeZone: format[resolvedSymbol].timeZone
    };

    addWECPropertyIfDefined(result, 'timeZoneName', fromPattern.timeZoneName);
    addWECPropertyIfDefined(result, 'era', fromPattern.era);
    addWECPropertyIfDefined(result, 'year', fromPattern.year);
    addWECPropertyIfDefined(result, 'month', fromPattern.month);
    addWECPropertyIfDefined(result, 'day', fromPattern.day);
    addWECPropertyIfDefined(result, 'weekday', fromPattern.weekday);
    addWECPropertyIfDefined(result, 'hour12', fromPattern.hour12);
    addWECPropertyIfDefined(result, 'hour', fromPattern.hour);
    addWECPropertyIfDefined(result, 'minute', fromPattern.minute);
    addWECPropertyIfDefined(result, 'second', fromPattern.second);

    return result;
  }
);


/**
 * Returns the subset of the given locale list for which this locale list
 * has a matching (possibly fallback) locale. Locales appear in the same
 * order in the returned list as in the input list.
 * Options are optional parameter.
 */
DEFINE_METHOD(
  GlobalIntlDateTimeFormat,
  supportedLocalesOf(locales) {
    return supportedLocalesOf('dateformat', locales, arguments[1]);
  }
);


/**
 * Returns a String value representing the result of calling ToNumber(date)
 * according to the effective locale and the formatting options of this
 * DateTimeFormat.
 */
function formatDate(formatter, dateValue) {
  var dateMs;
  if (IS_UNDEFINED(dateValue)) {
    dateMs = %DateCurrentTime();
  } else {
    dateMs = TO_NUMBER(dateValue);
  }

  return %InternalDateFormat(formatter, dateMs);
}

// Length is 1 as specified in ECMA 402 v2+
AddBoundMethod(GlobalIntlDateTimeFormat, 'format', formatDate, 1, DATE_TIME_FORMAT_TYPE,
               true);


/**
 * Returns canonical Area/Location(/Location) name, or throws an exception
 * if the zone name is invalid IANA name.
 */
function canonicalizeTimeZoneID(tzID) {
  // Skip undefined zones.
  if (IS_UNDEFINED(tzID)) {
    return tzID;
  }

  // Convert zone name to string.
  tzID = TO_STRING(tzID);

  // Special case handling (UTC, GMT).
  var upperID = %StringToUpperCaseIntl(tzID);
  if (upperID === 'UTC' || upperID === 'GMT' ||
      upperID === 'ETC/UTC' || upperID === 'ETC/GMT') {
    return 'UTC';
  }

  // TODO(jshin): Add support for Etc/GMT[+-]([1-9]|1[0-2])

  // We expect only _, '-' and / beside ASCII letters.
  // All inputs should conform to Area/Location(/Location)* from now on.
  var match = %regexp_internal_match(GetTimezoneNameCheckRE(), tzID);
  if (IS_NULL(match)) throw %make_range_error(kExpectedTimezoneID, tzID);

  var result = toTitleCaseTimezoneLocation(match[1]) + '/' +
               toTitleCaseTimezoneLocation(match[2]);

  if (!IS_UNDEFINED(match[3]) && 3 < match.length) {
    var locations = %StringSplit(match[3], '/', kMaxUint32);
    // The 1st element is empty. Starts with i=1.
    for (var i = 1; i < locations.length; i++) {
      result = result + '/' + toTitleCaseTimezoneLocation(locations[i]);
    }
  }

  return result;
}

/**
 * Initializes the given object so it's a valid BreakIterator instance.
 * Useful for subclassing.
 */
function CreateBreakIterator(locales, options) {
  if (IS_UNDEFINED(options)) {
    options = {__proto__: null};
  }

  var getOption = getGetOption(options, 'breakiterator');

  var internalOptions = {__proto__: null};

  defineWEProperty(internalOptions, 'type', getOption(
    'type', 'string', ['character', 'word', 'sentence', 'line'], 'word'));

  var locale = resolveLocale('breakiterator', locales, options);
  var resolved = %object_define_properties({__proto__: null}, {
    requestedLocale: {value: locale.locale, writable: true},
    type: {value: internalOptions.type, writable: true},
    locale: {writable: true}
  });

  var iterator = %CreateBreakIterator(locale.locale, internalOptions, resolved);

  %MarkAsInitializedIntlObjectOfType(iterator, BREAK_ITERATOR_TYPE);
  iterator[resolvedSymbol] = resolved;

  return iterator;
}


/**
 * Constructs Intl.v8BreakIterator object given optional locales and options
 * parameters.
 *
 * @constructor
 */
function v8BreakIteratorConstructor() {
  return IntlConstruct(this, GlobalIntlv8BreakIterator, CreateBreakIterator,
                       new.target, arguments);
}
%SetCode(GlobalIntlv8BreakIterator, v8BreakIteratorConstructor);


/**
 * BreakIterator resolvedOptions method.
 */
DEFINE_METHOD(
  GlobalIntlv8BreakIterator.prototype,
  resolvedOptions() {
    if (!IS_UNDEFINED(new.target)) {
      throw %make_type_error(kOrdinaryFunctionCalledAsConstructor);
    }

    var methodName = 'resolvedOptions';
    if(!IS_RECEIVER(this)) {
      throw %make_type_error(kIncompatibleMethodReceiver, methodName, this);
    }
    var segmenter = %IntlUnwrapReceiver(this, BREAK_ITERATOR_TYPE,
                                        GlobalIntlv8BreakIterator, methodName,
                                        false);

    return {
      locale: segmenter[resolvedSymbol].locale,
      type: segmenter[resolvedSymbol].type
    };
  }
);


/**
 * Returns the subset of the given locale list for which this locale list
 * has a matching (possibly fallback) locale. Locales appear in the same
 * order in the returned list as in the input list.
 * Options are optional parameter.
 */
DEFINE_METHOD(
  GlobalIntlv8BreakIterator,
  supportedLocalesOf(locales) {
    if (!IS_UNDEFINED(new.target)) {
      throw %make_type_error(kOrdinaryFunctionCalledAsConstructor);
    }

    return supportedLocalesOf('breakiterator', locales, arguments[1]);
  }
);


/**
 * Adopts text to segment using the iterator. Old text, if present,
 * gets discarded.
 */
function adoptText(iterator, text) {
  %BreakIteratorAdoptText(iterator, TO_STRING(text));
}


/**
 * Returns index of the first break in the string and moves current pointer.
 */
function first(iterator) {
  return %BreakIteratorFirst(iterator);
}


/**
 * Returns the index of the next break and moves the pointer.
 */
function next(iterator) {
  return %BreakIteratorNext(iterator);
}


/**
 * Returns index of the current break.
 */
function current(iterator) {
  return %BreakIteratorCurrent(iterator);
}


/**
 * Returns type of the current break.
 */
function breakType(iterator) {
  return %BreakIteratorBreakType(iterator);
}


AddBoundMethod(GlobalIntlv8BreakIterator, 'adoptText', adoptText, 1,
               BREAK_ITERATOR_TYPE, false);
AddBoundMethod(GlobalIntlv8BreakIterator, 'first', first, 0,
               BREAK_ITERATOR_TYPE, false);
AddBoundMethod(GlobalIntlv8BreakIterator, 'next', next, 0,
               BREAK_ITERATOR_TYPE, false);
AddBoundMethod(GlobalIntlv8BreakIterator, 'current', current, 0,
               BREAK_ITERATOR_TYPE, false);
AddBoundMethod(GlobalIntlv8BreakIterator, 'breakType', breakType, 0,
               BREAK_ITERATOR_TYPE, false);

// Save references to Intl objects and methods we use, for added security.
var savedObjects = {
  __proto__: null,
  'collator': GlobalIntlCollator,
  'numberformat': GlobalIntlNumberFormat,
  'dateformatall': GlobalIntlDateTimeFormat,
  'dateformatdate': GlobalIntlDateTimeFormat,
  'dateformattime': GlobalIntlDateTimeFormat
};


// Default (created with undefined locales and options parameters) collator,
// number and date format instances. They'll be created as needed.
var defaultObjects = {
  __proto__: null,
  'collator': UNDEFINED,
  'numberformat': UNDEFINED,
  'dateformatall': UNDEFINED,
  'dateformatdate': UNDEFINED,
  'dateformattime': UNDEFINED,
};

function clearDefaultObjects() {
  defaultObjects['dateformatall'] = UNDEFINED;
  defaultObjects['dateformatdate'] = UNDEFINED;
  defaultObjects['dateformattime'] = UNDEFINED;
}

var date_cache_version = 0;

function checkDateCacheCurrent() {
  var new_date_cache_version = %DateCacheVersion();
  if (new_date_cache_version == date_cache_version) {
    return;
  }
  date_cache_version = new_date_cache_version;

  clearDefaultObjects();
}

/**
 * Returns cached or newly created instance of a given service.
 * We cache only default instances (where no locales or options are provided).
 */
function cachedOrNewService(service, locales, options, defaults) {
  var useOptions = (IS_UNDEFINED(defaults)) ? options : defaults;
  if (IS_UNDEFINED(locales) && IS_UNDEFINED(options)) {
    checkDateCacheCurrent();
    if (IS_UNDEFINED(defaultObjects[service])) {
      defaultObjects[service] = new savedObjects[service](locales, useOptions);
    }
    return defaultObjects[service];
  }
  return new savedObjects[service](locales, useOptions);
}

// TODO(ftang) remove the %InstallToContext once
// cachedOrNewService is available in C++
%InstallToContext([
  "cached_or_new_service", cachedOrNewService
]);

/**
 * Returns actual formatted date or fails if date parameter is invalid.
 */
function toLocaleDateTime(date, locales, options, required, defaults, service) {
  if (!(date instanceof GlobalDate)) {
    throw %make_type_error(kMethodInvokedOnWrongType, "Date");
  }

  var dateValue = TO_NUMBER(date);
  if (NUMBER_IS_NAN(dateValue)) return 'Invalid Date';

  var internalOptions = toDateTimeOptions(options, required, defaults);

  var dateFormat =
      cachedOrNewService(service, locales, options, internalOptions);

  return formatDate(dateFormat, date);
}


/**
 * Formats a Date object (this) using locale and options values.
 * If locale or options are omitted, defaults are used - both date and time are
 * present in the output.
 */
DEFINE_METHOD(
  GlobalDate.prototype,
  toLocaleString() {
    var locales = arguments[0];
    var options = arguments[1];
    return toLocaleDateTime(
        this, locales, options, 'any', 'all', 'dateformatall');
  }
);


/**
 * Formats a Date object (this) using locale and options values.
 * If locale or options are omitted, defaults are used - only date is present
 * in the output.
 */
DEFINE_METHOD(
  GlobalDate.prototype,
  toLocaleDateString() {
    var locales = arguments[0];
    var options = arguments[1];
    return toLocaleDateTime(
        this, locales, options, 'date', 'date', 'dateformatdate');
  }
);


/**
 * Formats a Date object (this) using locale and options values.
 * If locale or options are omitted, defaults are used - only time is present
 * in the output.
 */
DEFINE_METHOD(
  GlobalDate.prototype,
  toLocaleTimeString() {
    var locales = arguments[0];
    var options = arguments[1];
    return toLocaleDateTime(
        this, locales, options, 'time', 'time', 'dateformattime');
  }
);

})
