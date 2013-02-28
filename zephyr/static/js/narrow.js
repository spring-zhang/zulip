var narrow = (function () {

var exports = {};

var filter_function   = false;
var current_operators = false;

exports.active = function () {
    // Cast to bool
    return !!filter_function;
};

exports.predicate = function () {
    if (filter_function) {
        return filter_function;
    } else {
        return function () { return true; };
    }
};

exports.operators = function () {
    return current_operators;
};

/* Operators we should send to the server. */
exports.public_operators = function () {
    var safe_to_return;
    safe_to_return = [];
    $.each(current_operators, function (index, value) {
        // Currently just filter out the "in" keyword.
        if (value[0] !== "in") {
            safe_to_return.push(value);
        }
    });
    if (safe_to_return.length !== 0) {
        return safe_to_return;
    }
};

/* Convert a list of operators to a string.
   Each operator is a key-value pair like

       ['subject', 'my amazing subject']

   These are not keys in a JavaScript object, because we
   might need to support multiple operators of the same type. */
function unparse(operators) {
    var parts = [];
    $.each(operators, function (index, elem) {
        var operator = elem[0];
        if (operator === 'search') {
            // Search terms are the catch-all case.
            // All tokens that don't start with a known operator and
            // a colon are glued together to form a search term.
            parts.push(elem[1]);
        } else {
            // FIXME: URI encoding will look really ugly
            parts.push(elem[0] + ':' + encodeURIComponent(elem[1]).toLowerCase());
        }
    });
    return parts.join(' ');
}

// Convert a list of operators to a human-readable description.
exports.describe = function (operators) {
    return $.map(operators, function (elem) {
        var operand = elem[1];
        switch (elem[0]) {
        case 'is':
            if (operand === 'private-message')
                return 'Narrow to all private messages';
            break;

        case 'stream':
            return 'Narrow to stream ' + operand;

        case 'subject':
            return 'Narrow to subject ' + operand;

        case 'sender':
            return 'Narrow to sender ' + operand;

        case 'pm-with':
            return 'Narrow to private messages with ' + operand;

        case 'search':
            return 'Search for ' + operand;

        case 'in':
            return 'Narrow to messages in ' + operand;
        }
        return 'Narrow to (unknown operator)';
    }).join(', ');
};

// Collect operators which appear only once into an object,
// and discard those which appear more than once.
function collect_single(operators) {
    var seen   = {};
    var result = {};
    $.each(operators, function (index, elem) {
        var key = elem[0];
        if (seen.hasOwnProperty(key)) {
            delete result[key];
        } else {
            result[key] = elem[1];
            seen  [key] = true;
        }
    });
    return result;
}

// Modify default compose parameters (stream etc.) based on
// the current narrowed view.
//
// This logic is here and not in the 'compose' module because
// it will get more complicated as we add things to the narrow
// operator language.
exports.set_compose_defaults = function (opts) {
    var single = collect_single(exports.operators());

    // Set the stream, subject, and/or PM recipient if they are
    // uniquely specified in the narrow view.
    $.each(['stream', 'subject'], function (idx, key) {
        if (single[key] !== undefined)
            opts[key] = single[key];
    });

    if (single['pm-with'] !== undefined)
        opts.private_message_recipient = single['pm-with'];
};

// Parse a string into a list of operators (see below).
exports.parse = function (str) {
    var operators   = [];
    var search_term = [];
    $.each(str.split(/ +/), function (idx, token) {
        var parts, operator;
        if (token.length === 0)
            return;
        parts = token.split(':');
        if (parts.length > 1) {
            // Looks like an operator.
            // FIXME: Should we skip unknown operator names here?
            operator = parts.shift();
            operators.push([operator, decodeURIComponent(parts.join(':'))]);
        } else {
            // Looks like a normal search term.
            search_term.push(token);
        }
    });
    // NB: Callers of 'parse' can assume that the 'search' operator is last.
    if (search_term.length > 0)
        operators.push(['search', search_term.join(' ')]);
    return operators;
};

exports.stream_in_home = function (stream_name) {
    // If we don't know about this stream for some reason,
    // we might not have loaded the in_home_view information
    // yet so show it
    var stream = subs.have(stream_name);
    if (stream) {
        return stream.in_home_view;
    } else {
        return true;
    }
};

exports.message_in_home = function (message) {
    if (message.type === "private") {
        return true;
    }

    return exports.stream_in_home(message.display_recipient);
};

// Build a filter function from a list of operators.
function build_filter(operators_mixed_case) {
    var operators = [];
    // We don't use $.map because it flattens returned arrays.
    $.each(operators_mixed_case, function (idx, operator) {
        operators.push([operator[0], operator[1].toLowerCase()]);
    });

    // FIXME: This is probably pretty slow.
    // We could turn it into something more like a compiler:
    // build JavaScript code in a string and then eval() it.

    return function (message) {
        var operand, i;
        for (i = 0; i < operators.length; i++) {
            operand = operators[i][1];
            switch (operators[i][0]) {
            case 'is':
                if (operand === 'private-message') {
                    if (message.type !== 'private')
                        return false;
                }
                break;

            case 'in':
                if (operand === 'home') {
                    return exports.in_home(message);
                }
                else if (operand === 'all') {
                    return true;
                }
                break;

            case 'stream':
                if ((message.type !== 'stream') ||
                    (message.display_recipient.toLowerCase() !== operand))
                    return false;
                break;

            case 'subject':
                if ((message.type !== 'stream') ||
                    (message.subject.toLowerCase() !== operand))
                    return false;
                break;

            case 'sender':
                if ((message.sender_email.toLowerCase() !== operand))
                    return false;
                break;

            case 'pm-with':
                if ((message.type !== 'private') ||
                    (message.reply_to.toLowerCase() !== operand))
                    return false;
                break;

            case 'search':
                var words = operand.trim().split(/\s+/);
                var j;
                for (j = 0; j < words.length; ++j) {
                    if (message.content.toLowerCase().indexOf(words[j]) === -1) {
                        if ((message.type !== 'stream') ||
                            (message.subject.toLowerCase().indexOf(words[j]) === -1)) {
                            return false;
                        }
                    }
                }
                break;
            }
        }

        // All filters passed.
        return true;
    };
}

exports.activate = function (operators, opts) {
    opts = $.extend({}, {
        then_select_id: home_msg_list.selected_id()
    }, opts);

    // Unfade the home view before we switch tables.
    compose.unfade_messages();

    var was_narrowed = exports.active();
    var then_select_id  = opts.then_select_id;

    filter_function   = build_filter(operators);
    current_operators = operators;

    narrowed_msg_list = new MessageList('zfilt');
    current_msg_list = narrowed_msg_list;

    function maybe_select_closest() {
        if (! narrowed_msg_list.empty()) {
            narrowed_msg_list.select_id(then_select_id, {then_scroll: true, use_closest: true});
        }
    }

    // Don't bother populating a message list when it won't contain
    // the message we want anyway
    if (all_msg_list.get(then_select_id) !== undefined) {
        add_messages(all_msg_list.all(), narrowed_msg_list);
    }

    function mark_loaded_as_unread() {
        // Mark as read any messages before or at the pointer in the narrowed view
        if (! narrowed_msg_list.empty()) {
            // XXX: We shouldn't really be directly accessing the message list
            var msgs = narrowed_msg_list.all();
            var i;
            var to_process = [];
            for (i = 0; i < msgs.length && msgs[i].id <= narrowed_msg_list.selected_id(); ++i) {
                to_process.push(msgs[i]);
            }

            process_unread_counts(to_process, true);
        }
    }

    if (narrowed_msg_list.empty()) {
        load_old_messages(then_select_id, 200, 200, narrowed_msg_list, function (messages) {
            maybe_select_closest();
            mark_loaded_as_unread();
        }, true, false);
    } else {
        mark_loaded_as_unread();
    }

    // Show the new set of messages.
    $("#main_div").addClass("narrowed_view");
    $("#zfilt").addClass("focused_table");
    $("#zhome").removeClass("focused_table");
    $("#zfilt").css("opacity", 0).animate({opacity: 1});

    reset_load_more_status();
    maybe_select_closest();

    function extract_search_terms(operators) {
        var i = 0;
        for (i = 0; i < operators.length; i++) {
            var type = operators[i][0];
            if (type === "search") {
                return operators[i][1];
            }
        }
        return undefined;
    }
    search.update_highlighting(extract_search_terms(operators));

    // Put the narrow operators in the URL fragment and search bar
    hashchange.save_narrow(operators);
    $('#search_query').val(unparse(operators));
    search.update_button_visibility();

    $("ul.filters li").removeClass('active-filter');
    if (operators.length === 1) {
        if (operators[0][0] === 'in' && operators[0][1] === 'all') {
            $("#global_filters li[data-name='all']").addClass('active-filter');
        } else if (operators[0][0] === "stream") {
            $("#stream_filters li[data-name='" + encodeURIComponent(operators[0][1]) + "']").addClass('active-filter');
        } else if (operators[0][0] === "is" && operators[0][1] === "private-message") {
            $("#global_filters li[data-name='private']").addClass('active-filter');
        }
    }
};

// Activate narrowing with a single operator.
// This is just for syntactic convenience.
exports.by = function (operator, operand, opts) {
    exports.activate([[operator, operand]], opts);
};

exports.by_subject = function (target_id) {
    var original = current_msg_list.get(target_id);
    if (original.type !== 'stream') {
        // Only stream messages have subjects, but the
        // user wants us to narrow in some way.
        exports.by_recipient(target_id);
        return;
    }
    exports.activate([
            ['stream',  original.display_recipient],
            ['subject', original.subject]
        ], { then_select_id: target_id });
};

// Called for the 'narrow by stream' hotkey.
exports.by_recipient = function (target_id) {
    var message = current_msg_list.get(target_id);
    var new_narrow, emails;
    switch (message.type) {
    case 'private':
        exports.by('pm-with', message.reply_to, { then_select_id: target_id });
        break;

    case 'stream':
        exports.by('stream', message.display_recipient, { then_select_id: target_id });
        break;
    }
};

exports.by_time_travel = function (target_id) {
    narrow.activate([], { then_select_id: target_id });
};

exports.deactivate = function () {
    if (!filter_function) {
        return;
    }
    filter_function   = false;
    current_operators = false;

    util.hide_empty_narrow_message();

    $("#main_div").removeClass('narrowed_view');
    $("#searchbox").removeClass('narrowed_view');
    $("#zfilt").removeClass('focused_table');
    $("#zhome").addClass('focused_table');
    $("#zhome").css("opacity", 0).animate({opacity: 1});

    $('#search_query').val('');
    reset_load_more_status();

    current_msg_list = home_msg_list;
    // We fall back to the closest selected id, if the user has removed a stream from the home
    // view since leaving it the old selected id might no longer be there
    home_msg_list.select_id(home_msg_list.selected_id(), {then_scroll: true, use_closest: true});

    search.clear_highlighting();

    hashchange.save_narrow();

    $("ul.filters li").removeClass('active-filter');
    $("#global_filters li[data-name='home']").addClass('active-filter');

    // This really shouldn't be necessary since the act of unnarrowing
    // fires a "message_selected.zephyr" event that in principle goes
    // and takes care of this, but on Safari (at least) there
    // seems to be some sort of order-of-events issue that causes
    // the scrolling not to happen, so this is my hack for now.
    scroll_to_selected();
};

exports.restore_home_state = function() {
    // If we click on the Home link while already at Home, unnarrow.
    // If we click on the Home link from another nav pane, just go
    // back to the state you were in (possibly still narrowed) before
    // you left the Home pane.
    if ($('#gear-menu li[title="Home"]').hasClass("active")) {
        exports.deactivate();
    }
    maybe_scroll_to_selected();
};

return exports;

}());
