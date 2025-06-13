const getVerificationEmailTemplate = (verificationLink) => {
  return `
    <h1>Xác nhận đăng ký tài khoản</h1>
    <p>Cảm ơn bạn đã đăng ký tài khoản tại BooTicket!</p>
    <p>Vui lòng nhấp vào liên kết dưới đây để xác nhận tài khoản của bạn:</p>
    <a href="${verificationLink}">Xác nhận tài khoản</a>
    <p>Liên kết này sẽ hết hạn sau 24 giờ.</p>
    <p>Nếu bạn không yêu cầu đăng ký tài khoản này, vui lòng bỏ qua email này.</p>
  `;
};

module.exports = {
  getVerificationEmailTemplate
}; 