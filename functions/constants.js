const intentType={
  RECIPE_REQUEST: 'recipe_request',
  MEAL_LOG: 'log_meal',
  MEAL_SELECTION_WITH_QUERY: 'get_meal_suggestions',
  OTHER: 'other',
}

const modelsToTry=['gemini-2.5-flash','gemini-2.5-pro','gemini-2.0-flash','gemini-2.0-pro'];
const onboardingQuestions=[
  {
    key: "diet_type",
    question: "Do you follow a vegetarian, non-vegetarian, or vegan diet?",
    description: "User’s overall dietary type or restriction.",
    type: "single-choice",
    options: ["vegetarian","non-vegetarian","vegan","eggetarian","other"]
  },
  {
    key: "egg_preference",
    question: "Do you eat eggs?",
    description: "Useful for distinguishing between vegetarian and eggetarian.",
    type: "yes-no"
  },
  {
    key: "allergies",
    question: "Do you have any food allergies?",
    description: "List of allergies like nuts, gluten, dairy, etc.",
    type: "text"
  },
  {
    key: "preferred_protein",
    question: "What are your preferred sources of protein?",
    description: "Could be paneer, chicken, tofu, dal, etc.",
    type: "multi-choice",
    options: ["paneer","tofu","chicken","eggs","dal","soy","other"]
  },
  {
    key: "non_veg_comfort",
    question: "Are you okay with seeing non-veg suggestions?",
    description: "Even vegetarians might be okay with seeing non-veg recipes for others.",
    type: "yes-no"
  },
  {
    key: "husband_diet",
    question: "Does your partner follow the same dietary preferences?",
    description: "Helps to adjust suggestions for shared meals.",
    type: "text"
  },
  {
    key: "disliked_ingredients",
    question: "Are there any ingredients you dislike?",
    description: "Not allergies, just dislikes like baingan, karela, etc.",
    type: "text"
  },
  {
    key: "preferred_cuisine",
    question: "Do you have preferred cuisines?",
    description: "Indian, Chinese, Italian, Thai, etc.",
    type: "multi-choice",
    options: ["Indian","Chinese","Italian","Thai","Continental","Other"]
  }
];

const preferencesMap=[
  "cuisine","do u have any food allergies","do u have any food restrictions",
  "do u have a cook?","are there any kids at home","where do u live",
  "allergies","diet type","egg preference",
  "preferred protein","non veg comfort","partner is any? and their diet",
  "disliked ingredients, if any","some of your favourite dishes",
]


module.exports={
  intentType,
  modelsToTry,preferencesMap
};