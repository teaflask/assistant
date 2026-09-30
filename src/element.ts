// The script-tag distribution's entry — the one deliberate side effect.
// Loading the bundle defines <teaflask-assistant> and
// <teaflask-assistant-page>; no DOM work happens until an element
// actually connects, so a <head> script tag is safe.
import cssText from "virtual:tf-element-styles";

import { defineTeaflaskAssistantElement } from "./element/assistant-element.js";
import { defineTeaflaskAssistantPageElement } from "./element/assistant-page-element.js";

defineTeaflaskAssistantElement({ cssText });
defineTeaflaskAssistantPageElement({ cssText });
