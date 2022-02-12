"use strict";
var alfy = require('alfy');
var tts = require("./tts");
var translator = require("./translate");
var configstore = require('configstore');
var os = require('os');
var uuidv4 = require('uuid/v4');
var languagePair = new configstore('language-config-pair');
var history = new configstore("translate-history");
var languages = require("./languages");
var SocksProxyAgent = require('socks-proxy-agent');

var g_config = {
    voice: process.env.voice || 'remote',
    save: process.env.save_count || 20,
    domain: process.env.domain || 'https://translate.google.com',
    agent: process.env.socks_proxy ? new SocksProxyAgent(process.env.socks_proxy) : undefined
};


// anki
var fromTextGlobal = "";
var toTextGlobal = "";
var deckDate = acquireCurrentDate();
// var deckName = "Default";
var deckName = "vocabulary::" + deckDate;
function invokeAnki(action, version, params={}) {
    return new Promise((resolve, reject) => {
        var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
        const xhr = new XMLHttpRequest();
        xhr.addEventListener('error', () => reject('failed to issue request'));
        xhr.addEventListener('load', () => {
            try {
                const response = JSON.parse(xhr.responseText);
                if (Object.getOwnPropertyNames(response).length != 2) {
                    throw 'response has an unexpected number of fields';
                }
                if (!response.hasOwnProperty('error')) {
                    throw 'response is missing required error field';
                }
                if (!response.hasOwnProperty('result')) {
                    throw 'response is missing required result field';
                }
                if (response.error) {
                    throw response.error;
                }
                resolve(response.result);
            } catch (e) {
                reject(e);
            }
        });

        xhr.open('POST', 'http://127.0.0.1:8765');
        xhr.send(JSON.stringify({action, version, params}));
    });
}

var pair = languagePair.get('pair');
if (pair) {
    // auto
    var pair0 = pair[0];
    var pair1 = pair[1];
    if (pair0 === 'auto' || pair1 === 'auto') {
        doTranslate({
            text: alfy.input,
            from: {
                language: 'auto',
                ttsfile: os.tmpdir() + '/' + uuidv4() + ".mp3"
            },
            to: {
                language: 'en',
                ttsfile: os.tmpdir() + '/' + uuidv4() + ".mp3"
            }
        });
        return;
    }
    // language detect
    translator
        .translate(alfy.input, {
            from: 'auto',
            to: 'en',
            domain: g_config.domain,
            client: 'gtx',
            agent: g_config.agent
        })
        .then(function (res) {
            var detect = res.from.language.iso;
            var from = 'auto';
            var to = 'en';
            if (pair0 === detect) {
                from = pair0;
                to = pair1;
            } else if (pair1 === detect) {
                from = pair1;
                to = pair0;
            }

            doTranslate({
                text: alfy.input,
                from: {
                    language: from,
                    ttsfile: os.tmpdir() + '/' + uuidv4() + ".mp3"
                },
                to: {
                    language: to,
                    ttsfile: os.tmpdir() + '/' + uuidv4() + ".mp3"
                }
            });
        });

} else {
    // manual
    var source = languagePair.get('source');
    var target = languagePair.get('target');
    var from = 'auto';
    var to = 'en';
    if (source && target) {
        from = source;
        to = target;
    }

    doTranslate({
        text: alfy.input,
        from: {
            language: from,
            ttsfile: os.tmpdir() + '/' + uuidv4() + ".mp3"
        },
        to: {
            language: to,
            ttsfile: os.tmpdir() + '/' + uuidv4() + ".mp3"
        }
    });
}

function doTranslate(opts) {
    //文档上说cmd+L时会找largetype，找不到会找arg，但是实际并不生效。
    //同时下一步的发音模块中query变量的值为arg的值。
    translator
        .translate(opts.text, {
            from: opts.from.language,
            to: opts.to.language,
            domain: g_config.domain,
            client: 'gtx',
            agent: g_config.agent
        })
        .then(function (res) {
            var items = [];

            if ('auto' === opts.from.language || res.from.language.didYouMean) {
                // Detected the input language not in configuration
                items.push({
                    title: res.to.text.value,
                    subtitle: `Detected the input language is ${languages[res.from.language.iso]}, not one of your configuration.`
                });

            } else if (res.from.corrected.corrected || res.from.corrected.didYouMean) {

                var corrected = res.from.corrected.value
                    .replace(/\[/, "")
                    .replace(/\]/, "");

                // Correct
                items.push({
                    title: res.to.text.value,
                    subtitle: `Show translation for ${corrected}?`,
                    autocomplete: corrected
                });

            } else {

                var fromPhonetic = res.from.text.phonetic;
                var fromText = res.from.text.value;
                var fromArg = g_config.voice === 'remote' ? opts.from.ttsfile : g_config.voice === 'local' ? fromText : '';
                // Input
                items.push({
                    title: fromText,
                    subtitle: `Phonetic: ${fromPhonetic}`,
                    quicklookurl: `${g_config.domain}/#view=home&op=translate&sl=${opts.from.language}&tl=${opts.to.language}&text=${encodeURIComponent(fromText)}`,
                    arg: fromArg,
                    text: {
                        copy: fromText,
                        largetype: fromText
                    },
                    icon: {
                        path: g_config.voice === 'none' ? 'icon.png' : 'tts.png'
                    }
                });

                var toPhonetic = res.to.text.phonetic;
                var toText = res.to.text.value;
                var toArg = g_config.voice === 'remote' ? opts.to.ttsfile : g_config.voice === 'local' ? toText : '';

                // anki show
                var step = 25;
                if (null != toText && toText.length > step) {
                    var l = toText.length / step;
                    var start = 0;
                    for (var i = 0; i < l; i++) {
                        var end = start + step;
                        var eachToText = '';
                        if (end < toText.length) {
                            eachToText = toText.substring(start, end);
                            start = end;
                        }
                        else {
                            end = toText.length - 1;
                            eachToText = toText.substring(start, end);
                        }
                        // Translation
                        items.push({
                            title: eachToText,
                            subtitle: `Phonetic: ${toPhonetic}`,
                            quicklookurl: `${g_config.domain}/#view=home&op=translate&sl=${opts.to.language}&tl=${opts.from.language}&text=${encodeURIComponent(toText)}`,
                            arg: toArg,
                            text: {
                                copy: eachToText,
                                largetype: eachToText
                            },
                            icon: {
                                path: g_config.voice === 'none' ? 'icon.png' : 'tts.png'
                            }
                        });
                    }
                }
                else {
                    // Translation
                    items.push({
                        title: toText,
                        subtitle: `Phonetic: ${toPhonetic}`,
                        quicklookurl: `${g_config.domain}/#view=home&op=translate&sl=${opts.to.language}&tl=${opts.from.language}&text=${encodeURIComponent(toText)}`,
                        arg: toArg,
                        text: {
                            copy: toText,
                            largetype: toText
                        },
                        icon: {
                            path: g_config.voice === 'none' ? 'icon.png' : 'tts.png'
                        }
                    });
                }

                // Definitions
                res.to.definitions.forEach(definition => {
                    items.push({
                        title: `Definition[${definition.partsOfSpeech}]: ${definition.value}`,
                        subtitle: `Example: ${definition.example}`,
                        text: {
                            copy: definition.value,
                            largetype: `Definition: ${definition.value}\n\nExample: ${definition.example}`
                        }
                    });
                });

                // Translation Of
                res.to.translations.forEach(translation => {
                    items.push({
                        title: `Translation[${translation.partsOfSpeech}]: ${translation.value}`,
                        subtitle: `Frequency: ${translation.frequency.toFixed(4)} Synonyms: ${translation.synonyms}`,
                        text: {
                            copy: translation.value,
                            largetype: `Translation: ${translation.value}\n\nSynonyms: ${translation.synonyms}`
                        }
                    });
                });
            }

            alfy.output(items);

            // save anki.
            if (null != items && items.length > 0) {
                try {
                    fromTextGlobal = JSON.stringify(items[0].title);
                    fromTextGlobal = replace8Str(fromTextGlobal);

                    toTextGlobal = "<div>" + items[1].title + "</div></br>";
                    for (var i = 2; i < items.length; i++) {
                        toTextGlobal += "<div>" + items[i].title + "<div>";
                        var subTitle = "<div>" + items[i].subtitle + "<div></br>";
                        // replace redundant str.
                        var synonymsIndex = subTitle.indexOf("Synonyms");
                        if (synonymsIndex > 0) {
                            subTitle = subTitle.substr(synonymsIndex + 9);
                        }
                        toTextGlobal += subTitle;
                    }
                    toTextGlobal = replace8Str(toTextGlobal);
                } catch (e) {
                    /*
                     * handler this case.
                     * "items": [{
                     *               "title": "为什么TC在脏写之后尝试无限回滚分支事务？",
                     *               "subtitle": "Show translation for Why does TC try to rollback branch transaction infinitely after a dirty write??",
                     *               "autocomplete": "Why does TC try to rollback branch transaction infinitely after a dirty write?"
                     *          }]
                     *
                     */
                    fromTextGlobal = JSON.stringify(items[0].autocomplete);
                    toTextGlobal = "<div>" + items[0].title + "</div></br>";
                }

                // anki
                invokeAnki('createDeck', 6, {
                    "deck": deckName
                });
                invokeAnki('addNote', 6, {
                    "note": {
                        "deckName": deckName,
                        "modelName": "Basic",
                        "fields": {
                            "Front": "" + fromTextGlobal,
                            "Back": "" + toTextGlobal + ""
                        },
                        "options": {
                            "allowDuplicate": true,
                        },
                        "tags": [
                            "glossary"
                        ]
                    }
                });

            }

            res.from.language.ttsfile = opts.from.ttsfile;
            res.to.language = {iso: opts.to.language, ttsfile: opts.to.ttsfile};
            return res;
        })
        .then(res => {
            // history, todo: could be optimized
            if (g_config.save > 0) {
                var value = {
                    time: Date.now(),
                    from: res.from.text.value,
                    to: res.to.text.value
                };
                var histories = history.get('history') ? JSON.parse(history.get('history')) : [];
                if (histories.length >= g_config.save) histories.shift();
                histories.push(value);
                history.set('history', JSON.stringify(histories));
            }

            return res;
        })
        .then(res => {
            // tts
            if (g_config.voice === 'remote') {
                var fromArray = [];
                res.from.text.array.forEach(o => tts.split(o).forEach(t => fromArray.push(t)));
                tts.multi(fromArray, {
                    to: res.from.language.iso,
                    domain: g_config.domain,
                    file: res.from.language.ttsfile,
                    client: 'gtx',
                    agent: g_config.agent
                });
                var toArray = [];
                res.to.text.array.forEach(o => tts.split(o).forEach(t => toArray.push(t)));
                tts.multi(toArray, {
                    to: res.to.language.iso,
                    domain: g_config.domain,
                    file: res.to.language.ttsfile,
                    client: 'gtx',
                    agent: g_config.agent
                });
            }
        })
    ;
}

// anki
function acquireCurrentDate() {
    // 获取当前日期
    var date = new Date();

    // 获取当前月份
    var nowMonth = date.getMonth() + 1;

    // 获取当前是几号
    var strDate = date.getDate();

    // 添加分隔符“-”
    var seperator = "-";

    // 对月份进行处理，1-9月在前面添加一个“0”
    if (nowMonth >= 1 && nowMonth <= 9) {
        nowMonth = "0" + nowMonth;
    }

    // 对月份进行处理，1-9号在前面添加一个“0”
    if (strDate >= 0 && strDate <= 9) {
        strDate = "0" + strDate;
    }

    // 最后拼接字符串，得到一个格式为(yyyy-MM-dd)的日期
    var nowDate = date.getFullYear() + seperator + nowMonth + seperator + strDate;

    return nowDate;
}

/**
 * anki
 * remove * in str
 */
function replace8Str(str) {
    return str.replace("*", "");
}