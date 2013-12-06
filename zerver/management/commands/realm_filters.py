from __future__ import absolute_import
from optparse import make_option

from django.core.management.base import BaseCommand
from zerver.models import RealmFilter, all_realm_filters, Realm
import sys

class Command(BaseCommand):
    help = """Create a realm for the specified domain.

Usage: python manage.py realm_filters foo.com PATTERN URLPATTERN

Example: python manage.py realm_filters --realm=zulip.com --op=add '#(?P<id>[0-9]{2,8})' 'https://trac.humbughq.com/ticket/%(id)s'
Example: python manage.py realm_filters --realm=zulip.com --op=remove '#(?P<id>[0-9]{2,8})'
Example: python manage.py realm_filters --realm=zulip.com --op=show
"""

    option_list = BaseCommand.option_list + (
        make_option('-r', '--realm',
                    dest='domain',
                    type='str',
                    help='The name of the realm to adjust filters for.'),
        make_option('--op',
                    dest='op',
                    type='str',
                    default="show",
                    help='What operation to do (add, show, remove).'),
        )

    def handle(self, *args, **options):
        if "domain" not in options:
            self.print_help("python manage.py", "realm_filters")
            sys.exit(1)

        realm = Realm.objects.get(domain=options["domain"])
        if options["op"] == "show":
            print "%s: %s" % (realm.domain, all_realm_filters().get(realm.domain, ""))
            sys.exit(0)

        if not args:
            self.print_help("python manage.py", "realm_filters")
            sys.exit(1)
        pattern = args[0]

        if options["op"] == "add":
            url_format_string = args[1]
            RealmFilter(realm=realm, pattern=pattern,
                        url_format_string=url_format_string).save()
            sys.exit(0)
        elif options["op"] == "remove":
            RealmFilter.objects.get(realm=realm, pattern=pattern).delete()
            sys.exit(0)
        else:
            self.print_help("python manage.py", "realm_filters")
            sys.exit(1)