class AppError(Exception):
    def __init__(self, message='This request could not be completed. Please try again.', status=503):
        self.message = message
        self.status = status
        super().__init__(message)
