const jwt = require("jsonwebtoken");
const secretKey = require("../secret/secretKey");

function setUser(user) {
  return jwt.sign(
    {
      _id: user._id,
      email: user.email,
    },
    secretKey
  );
}

function getUser(token) {
  return jwt.verify(token, secretKey);
}

module.exports = {
  setUser,
  getUser,
};
