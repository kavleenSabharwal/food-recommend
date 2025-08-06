function timeNow() {
  const now=new Date();
  const istOffset=5.5*60*60000;
  const istTime=new Date(now.getTime()+istOffset);
  return now;
}

function istTime() {
  const now=new Date();
  const istOffset=5.5*60*60000;
  const istTime=new Date(now.getTime()+istOffset);
  return istTime;
}


function guessMealTypeFromTime(hour) {
  if(hour>=6&&hour<=10) return 'Breakfast';
  if(hour>=12&&hour<=16) return 'Lunch';
  if(hour>=18&&hour<=22) return 'Dinner';
  return null;
}


module.exports={timeNow,istTime,guessMealTypeFromTime}; // ✅ named export
