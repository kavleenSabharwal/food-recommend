const intentType={
  RECIPE_REQUEST: 'recipe_request',
  MEAL_LOG: 'meal_log',
  MEAL_SELECTION_WITH_QUERY: 'meal_selection_with_query',
  OTHER: 'other',
}

const modelsToTry=['gemini-2.5-flash','gemini-2.5-pro','gemini-2.0-flash','gemini-2.0-pro'];


module.exports={
  intentType,
  modelsToTry
};