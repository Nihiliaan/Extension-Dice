import { animation_duration } from '../../../../script.js';
import { renderExtensionTemplateAsync } from '../../../extensions.js';
import { POPUP_TYPE, callGenericPopup } from '../../../popup.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from '../../../slash-commands/SlashCommandArgument.js';
import { commonEnumProviders } from '../../../slash-commands/SlashCommandCommonEnumsProvider.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { isTrueBoolean } from '../../../utils.js';
export { MODULE_NAME };

const MODULE_NAME = 'dice';
const TEMPLATE_PATH = 'third-party/Extension-Dice';

// Define default settings
const defaultSettings = Object.freeze({
    functionTool: false,
    addToContext: true,
});

// Define a function to get or initialize settings
function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();

    // Initialize settings if they don't exist
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }

    // Ensure all default keys exist (helpful after updates)
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
            extensionSettings[MODULE_NAME][key] = defaultSettings[key];
        }
    }

    return extensionSettings[MODULE_NAME];
}

/**
 * Parses a dice formula and returns a detailed breakdown.
 * @param {string} formula Dice formula (e.g., 2d4+4+5d4+5)
 * @returns {{formula: string, breakdown: string, total: number}}
 */
function evaluateFormula(formula) {
    const parts = formula.replace(/\s+/g, '').match(/([+-]?[^+-]+)/g) || [];
    let totalValue = 0;
    const breakdownParts = [];

    for (let part of parts) {
        let isNegative = false;
        if (part.startsWith('-')) {
            isNegative = true;
            part = part.substring(1);
        } else if (part.startsWith('+')) {
            part = part.substring(1);
        }

        const diceMatch = part.match(/^(\d+)d(\d+)$/i);
        if (diceMatch) {
            const numDice = parseInt(diceMatch[1]);
            const numSides = parseInt(diceMatch[2]);
            const rolls = [];
            let sum = 0;
            for (let i = 0; i < numDice; i++) {
                const roll = Math.floor(Math.random() * numSides) + 1;
                rolls.push(roll);
                sum += roll;
            }
            totalValue += isNegative ? -sum : sum;
            const prefix = isNegative ? '-' : (breakdownParts.length > 0 ? '+' : '');
            breakdownParts.push(`${prefix}${sum}[${rolls.join('+')}]`);
        } else {
            const val = parseInt(part);
            if (!isNaN(val)) {
                totalValue += isNegative ? -val : val;
                const prefix = isNegative ? '-' : (breakdownParts.length > 0 ? '+' : '');
                breakdownParts.push(`${prefix}${val}`);
            }
        }
    }

    return {
        formula: formula,
        breakdown: breakdownParts.join(''),
        total: totalValue,
    };
}

/**
 * Roll the dice.
 * @param {string} customDiceFormula Dice formula
 * @param {boolean} quiet Suppress chat output
 * @param {string} label Optional label for the roll
 * @returns {Promise<string>} Total result as string
 */
async function doDiceRoll(customDiceFormula, quiet = false, label = '') {
    let value = typeof customDiceFormula === 'string' ? customDiceFormula.trim() : $(this).data('value');

    if (value == 'custom') {
        value = await callGenericPopup('输入骰子公式：<br><i>（例如 <tt>2d6</tt>）</i>', POPUP_TYPE.INPUT, '', { okButton: '掷骰', cancelButton: '取消' });
    }

    if (!value) return '';

    // Simple validation: regex for basic dice notation and numbers with operators
    const isValid = /^(\d+d\d+|\d+)([+-](\d+d\d+|\d+))*(\s+.*)?$/i.test(value);

    if (isValid) {
        // Separate formula from label if not provided
        let formulaPart = value;
        let labelPart = label;
        if (!label && value.includes(' ')) {
            const spaceIndex = value.indexOf(' ');
            formulaPart = value.substring(0, spaceIndex);
            labelPart = value.substring(spaceIndex + 1).trim();
        }

        const context = SillyTavern.getContext();
        const userName = context.name1;
        const processedFormula = formulaPart.replace(/{{user}}/gi, userName);
        
        const result = evaluateFormula(processedFormula);
        if (!result) return '';

        if (!quiet) {
            const labelStr = labelPart ? `：${labelPart}` : '';
            const displayMessage = `${userName}骰了 ${formulaPart}${labelStr}\n${result.breakdown} = ${result.total}`;
            
            const settings = getSettings();
            if (settings.addToContext) {
                const newMessage = {
                    name: 'System',
                    role: 'system',
                    mes: displayMessage,
                    is_system: true,
                    is_user: false,
                    send_date: context.timestampToMoment ? context.timestampToMoment(Date.now()).format() : new Date().toISOString(),
                };
                context.chat.push(newMessage);
                if (typeof context.addOneMessage === 'function') {
                    context.addOneMessage(newMessage);
                }
                if (typeof context.saveChatDebounced === 'function') {
                    context.saveChatDebounced();
                } else if (typeof context.saveSettingsDebounced === 'function') {
                    context.saveSettingsDebounced();
                }
            } else {
                context.sendSystemMessage('generic', displayMessage, { isSmallSys: true });
            }
        }
        return String(result.total);
    } else {
        toastr.warning('无效的骰子公式');
        return '';
    }
}

async function addDiceRollButton() {
    const buttonHtml = await renderExtensionTemplateAsync(TEMPLATE_PATH, 'button');
    const dropdownHtml = await renderExtensionTemplateAsync(TEMPLATE_PATH, 'dropdown');
    const settingsHtml = await renderExtensionTemplateAsync(TEMPLATE_PATH, 'settings');

    const getWandContainer = () => $(document.getElementById('dice_wand_container') ?? document.getElementById('extensionsMenu'));
    getWandContainer().append(buttonHtml);

    const getSettingsContainer = () => $(document.getElementById('dice_container') ?? document.getElementById('extensions_settings2'));
    getSettingsContainer().append(settingsHtml);

    const settings = getSettings();
    $('#dice_function_tool').prop('checked', settings.functionTool).on('change', function () {
        settings.functionTool = !!$(this).prop('checked');
        SillyTavern.getContext().saveSettingsDebounced();
        registerFunctionTools();
    });
    $('#dice_add_to_context').prop('checked', settings.addToContext).on('change', function () {
        settings.addToContext = !!$(this).prop('checked');
        SillyTavern.getContext().saveSettingsDebounced();
    });

    $(document.body).append(dropdownHtml);
    $('#dice_dropdown li').on('click', function () {
        dropdown.fadeOut(animation_duration);
        doDiceRoll($(this).data('value'), false);
    });
    const button = $('#roll_dice');
    const dropdown = $('#dice_dropdown');
    dropdown.hide();

    const popper = SillyTavern.libs.Popper.createPopper(button.get(0), dropdown.get(0), {
        placement: 'top',
    });

    $(document).on('click touchend', function (e) {
        const target = $(e.target);
        if (target.is(dropdown) || target.closest(dropdown).length) return;
        if (target.is(button) && !dropdown.is(':visible')) {
            e.preventDefault();

            dropdown.fadeIn(animation_duration);
            popper.update();
        } else {
            dropdown.fadeOut(animation_duration);
        }
    });
}

function registerFunctionTools() {
    try {
        const { registerFunctionTool, unregisterFunctionTool } = SillyTavern.getContext();
        if (!registerFunctionTool || !unregisterFunctionTool) {
            console.debug('Dice: function tools are not supported');
            return;
        }

        unregisterFunctionTool('RollTheDice');

        // Function tool is disabled by the settings
        const settings = getSettings();
        if (!settings.functionTool) {
            return;
        }

        const rollDiceSchema = Object.freeze({
            $schema: 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                who: {
                    type: 'string',
                    description: 'The name of the persona rolling the dice',
                },
                formula: {
                    type: 'string',
                    description: 'A dice formula to roll, e.g. 2d6',
                },
            },
            required: [
                'who',
                'formula',
            ],
        });

        registerFunctionTool({
            name: 'RollTheDice',
            displayName: '掷骰子',
            description: '使用提供的公式掷骰并返回数值结果。当需要掷骰子来决定行动的结果或用户要求时使用。',
            parameters: rollDiceSchema,
            action: async (args) => {
                if (!args?.formula) args = { formula: '1d6' };
                const total = await doDiceRoll(args.formula, true);
                const who = args.who || '系统';
                return `${who} 掷出了 ${args.formula}，结果为 ${total}`;
            },
            formatMessage: () => '',
        });
    } catch (error) {
        console.error('Dice: Error registering function tools', error);
    }
}

jQuery(async function () {
    await addDiceRollButton();
    registerFunctionTools();
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'roll',
        aliases: ['r'],
        callback: async (args, value) => {
            const quiet = isTrueBoolean(String(args.quiet));
            const resultTotal = await doDiceRoll(String(value || '1d6'), quiet);
            return resultTotal;
        },
        helpString: '掷骰子。支持公式如 2d6+4 并在其后添加标签。',
        returns: '掷骰结果数值',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'quiet',
                description: '不在聊天中显示结果',
                isRequired: false,
                typeList: [ARGUMENT_TYPE.BOOLEAN],
                defaultValue: String(false),
                enumProvider: commonEnumProviders.boolean('trueFalse'),
            }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: '骰子公式，例如 2d6+4，可后跟标签',
                isRequired: true,
                typeList: [ARGUMENT_TYPE.STRING],
            }),
        ],
    }));
});
