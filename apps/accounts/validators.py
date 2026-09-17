import re

from django.core.exceptions import ValidationError
from django.utils.translation import gettext as _


class ProductPasswordValidator:
    def validate(self, password, user=None):
        if (
            len(password) < 10
            or re.fullmatch(r"[A-Za-z0-9_]+", password) is None
            or re.search(r"[a-z]", password) is None
            or re.search(r"[A-Z]", password) is None
            or re.search(r"[0-9]", password) is None
            or "_" not in password
        ):
            raise ValidationError(self.get_help_text(), code="invalid_product_password")

    def get_help_text(self):
        return _(
            "Use at least 10 characters: only Latin letters, digits and underscores, "
            "including a lowercase letter, an uppercase letter, a digit and an underscore."
        )
