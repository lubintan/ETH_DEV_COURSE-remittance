// Generates 10-character case-sensitive alphanumeric passcodes.

const alphas = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const nums = "0123456789"

const codeLen = 10

function subGenerator(length, pool) {
    let newString = '' 
    for(i=0; i<length; i++){
        newString += pool[Math.floor(Math.random() * pool.length)];
    }
    return newString;
}

function remove_character(s, index) {
  sub1 = s.substring(0, index);
  sub2 = s.substring(index + 1, s.length);
  return (sub1 + sub2);
}

function shuffle(s) {
    let str = s;
    let len = str.length;
    let newString = '';
    while (len > 0){
        index = Math.floor(Math.random() * len);
        newString += str[index];
        str = remove_character(str, index);
        len = str.length; 
    }
    return newString;
}

module.exports ={
    generator: function() {
            //at least 1 alphabet
        let numAlphas = Math.ceil(Math.random() * codeLen);
        let numNums = codeLen - numAlphas;

        let newString = subGenerator(numAlphas, alphas);
        newString += subGenerator(numNums, nums);

        return shuffle(newString);
    }
}